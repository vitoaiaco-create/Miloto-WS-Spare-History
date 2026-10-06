"use server"

import { auth } from "@clerk/nextjs/server"
import { format } from "date-fns"
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import Papa from "papaparse"
import { z } from "zod"

import { db } from "@/db"
import {
  assetsTable,
  driversTable,
  manualAlignmentEventsTable,
  masterTaxonomyDictionaryTable,
  mechanicalSparesTable,
  mileageLogsTable,
  monthlyPairingsTable,
  oilConsumptionLogsTable,
  oilSamplesTable,
  tirePenaltiesTable,
  unmappedSparesStagingTable,
} from "@/db/schema"
import {
  indexRowByHeader,
  inferAssetType,
  isPopulatedCsvRow,
  parseSpreadsheetDate,
  toCanonicalFleetNumber,
  toIsoDateString,
  toNumber,
  toTrimmedString,
} from "@/lib/spreadsheet"
import {
  alignmentRowSchema,
  assetRowSchema,
  oilConsumptionRowSchema,
  pairingRowSchema,
  sparesRowSchema,
  tirePenaltyRowSchema,
  type AlignmentRow,
  type OilConsumptionRow,
  type PairingRow,
  type SparesRow,
  type TirePenaltyRow,
} from "@/lib/validations"

// Postgres caps a statement at 65535 bound parameters, and the mileage log
// runs to ~36k rows, so inserts are issued in chunks rather than as one
// statement.
const INSERT_CHUNK_SIZE = 500

// Uploads are batched by `src/components/data-uploader.tsx` to stay under
// the Server Action body limit, so each call carries the 1-based spreadsheet
// row number of its first row. Rejected rows are reported by that number,
// letting staff find the offending line in Excel.
const ingestInputSchema = z.object({
  rows: z.array(z.unknown()),
  firstRowNumber: z.number().int().positive(),
})

export type IngestInput = z.infer<typeof ingestInputSchema>

export type SkippedRow = { rowNumber: number; error: string }

export type IngestResult = {
  // Rows actually written.
  imported: number
  // Valid rows that were already on file. Every table has a unique index
  // over its natural key (see `src/db/schema.ts`), so re-importing a report
  // tops up instead of duplicating or failing.
  duplicates: number
  // Rows that failed validation, with the spreadsheet row number.
  skipped: SkippedRow[]
  createdAssets: string[]
  // Rows whose Part Number did not match `masterTaxonomyDictionaryTable`
  // and were diverted into `unmappedSparesStagingTable` instead of
  // `mechanicalSparesTable` — see `ingestSpares` below. Already counted in
  // `imported` (they were written somewhere); this just breaks out how many
  // of those now need triage. Optional because only `ingestSpares` can ever
  // produce this diversion.
  divertedToTriage?: number
}

// The data ingestion tools write directly into the fleet's asset, spares,
// mileage and oil tables, so every action here is gated to admins only — see
// src/app/data-ingestion/page.tsx for the matching UI-level gate and
// src/proxy.ts for the route-level gate. Exported so other admin-only
// Server Actions (e.g. `seedMasterTaxonomyDictionary` in
// src/actions/dictionary-seed.ts) can reuse the same check.
export async function requireAdmin() {
  const { userId, sessionClaims } = await auth()

  if (!userId || sessionClaims?.metadata?.role !== "admin") {
    throw new Error("Unauthorized: Admin access required")
  }
}

// Sample lifecycle actions are used by workshop staff on Oils & Servicing.
// Bulk importers stay admin-only. The dedicated `oils_only` role is allowed
// even without the `oils_servicing` module claim.
async function requireOilSampleAccess() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    throw new Error("Unauthorized")
  }

  const isOilsOnly = sessionClaims?.metadata?.role === "oils_only"
  if (isOilsOnly) {
    return
  }

  const isAdmin = sessionClaims?.metadata?.role === "admin"
  const hasOilsModule =
    sessionClaims?.metadata?.modules?.includes("oils_servicing") ?? false

  if (!isAdmin && !hasOilsModule) {
    throw new Error("Unauthorized")
  }
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

// Validates each row on its own so that a single malformed line doesn't cost
// the operator the rest of the file — the current outward report has one row
// with no "Amount (K)" cell, and rejecting the batch over it would have
// dropped the other 464. Skipped rows are returned for reporting rather than
// swallowed.
function partitionRows<Schema extends z.ZodType>(
  rows: unknown[],
  schema: Schema,
  firstRowNumber: number
) {
  const valid: z.output<Schema>[] = []
  const skipped: SkippedRow[] = []

  for (const [index, row] of rows.entries()) {
    const parsed = schema.safeParse(row)

    if (parsed.success) {
      valid.push(parsed.data)
    } else {
      skipped.push({
        rowNumber: firstRowNumber + index,
        // A bad row usually trips several field checks at once; the first
        // message is enough to point at the problem.
        error: parsed.error.issues[0]?.message ?? "Row could not be validated",
      })
    }
  }

  return { valid, skipped }
}

function selectAssetsByName(fleetNumbers: string[]) {
  return db
    .select({ id: assetsTable.id, assetName: assetsTable.assetName })
    .from(assetsTable)
    .where(inArray(assetsTable.assetName, fleetNumbers))
}

// Spreadsheet rows identify an asset by its fleet number (e.g. "MTL25"), but
// `mechanicalSparesTable`/`mileageLogsTable`/`oilConsumptionLogsTable`
// reference it via the numeric `assetsTable.id` foreign key. This resolves
// every fleet number in a batch to its `assetId`, registering any that isn't
// on file yet with the type implied by its code.
//
// Assets are created rather than rejected because the outward report covers
// trailers, cranes and the tow truck, none of which appear in the
// prime-mover fleet list — roughly a quarter of every import would otherwise
// fail. The fleet numbers created are returned so the uploader can tell
// staff which assets appeared, since a mistyped Identity No would otherwise
// register a junk asset silently.
async function resolveAssetIdsByFleetNumber(fleetNumbers: string[]) {
  const uniqueFleetNumbers = [...new Set(fleetNumbers)]

  if (uniqueFleetNumbers.length === 0) {
    return {
      assetIdByFleetNumber: new Map<string, number>(),
      createdFleetNumbers: [] as string[],
    }
  }

  const knownAssets = await selectAssetsByName(uniqueFleetNumbers)
  const knownFleetNumbers = new Set(knownAssets.map((asset) => asset.assetName))
  const missingFleetNumbers = uniqueFleetNumbers.filter(
    (fleetNumber) => !knownFleetNumbers.has(fleetNumber)
  )

  if (missingFleetNumbers.length === 0) {
    return {
      assetIdByFleetNumber: new Map(
        knownAssets.map((asset) => [asset.assetName, asset.id] as const)
      ),
      createdFleetNumbers: [] as string[],
    }
  }

  for (const batch of chunk(missingFleetNumbers, INSERT_CHUNK_SIZE)) {
    await db
      .insert(assetsTable)
      .values(
        batch.map((fleetNumber) => ({
          assetName: fleetNumber,
          assetType: inferAssetType(fleetNumber),
        }))
      )
      // `assetName` is unique; ignore anything a concurrent import created.
      .onConflictDoNothing({ target: assetsTable.assetName })
  }

  const assets = await selectAssetsByName(uniqueFleetNumbers)

  return {
    assetIdByFleetNumber: new Map(
      assets.map((asset) => [asset.assetName, asset.id] as const)
    ),
    createdFleetNumbers: missingFleetNumbers,
  }
}

// The taxonomy a matched row is inserted with — straight from
// `masterTaxonomyDictionaryTable`. A tier the dictionary left blank
// becomes an empty string so the NOT NULL columns on
// `mechanicalSparesTable` still accept the row; the ERP Sub
// Equipment/Category/Sub-Category cells are never used as a fallback
// (those stay on `subEquipment`/`category`/`subCategory`).
type ResolvedTaxonomy = {
  tier1: string
  tier2: string
  tier3: string
  assetClass: string | null
}

function toSpareInsertValues(
  row: SparesRow,
  assetIdByFleetNumber: Map<string, number>,
  taxonomy: ResolvedTaxonomy
) {
  return {
    assetId: assetIdByFleetNumber.get(row.fleetNumber)!,
    sNo: row.sNo,
    materialName: row.materialName,
    partNumber: row.partNumber,
    category: row.category,
    subCategory: row.subCategory,
    jobCardType: row.jobCardType,
    subEquipment: row.subEquipment,
    brandName: row.brandName,
    supplierName: row.supplierName,
    docketNo: row.docketNo,
    vehicleNo: row.vehicleNo,
    identityNo: row.identityNo,
    odometer: row.odometer === null ? null : Math.round(row.odometer),
    // The money/quantity columns are `numeric()`, which Drizzle represents
    // as strings by default (see src/db/schema.ts) — the Zod schema
    // validates them as numbers, so we convert back here.
    quantity: row.quantity.toString(),
    exRate: row.exRate?.toString() ?? null,
    priceKwacha: row.priceKwacha.toString(),
    amountKwacha: row.amountKwacha?.toString() ?? null,
    priceUsd: row.priceUsd?.toString() ?? null,
    amountUsd: row.amountUsd?.toString() ?? null,
    outwardDate: toIsoDateString(row.outwardDate),
    jobCardNo: row.jobCardNo,
    issuedBy: row.issuedBy,
    collectedBy: row.collectedBy,
    returnQuantity: row.returnQuantity?.toString() ?? null,
    installationPoint: row.installationPoint,
    tier1: taxonomy.tier1,
    tier2: taxonomy.tier2,
    tier3: taxonomy.tier3,
    assetClass: taxonomy.assetClass,
  }
}

// A row whose Part Number isn't in the dictionary yet carries no taxonomy
// at all — the CSV's own Sub Equipment/Category/Sub-Category columns stay
// as raw ERP fields on the staging row and are never copied into
// `tier1`/`tier2`/`tier3`. The whole point of staging is to have a human
// pick the canonical tiers rather than letting ad-hoc report values leak
// into `mechanicalSparesTable`.
function toStagingInsertValues(
  row: SparesRow,
  assetIdByFleetNumber: Map<string, number>
) {
  return {
    assetId: assetIdByFleetNumber.get(row.fleetNumber)!,
    sNo: row.sNo,
    materialName: row.materialName,
    partNumber: row.partNumber,
    category: row.category,
    subCategory: row.subCategory,
    jobCardType: row.jobCardType,
    subEquipment: row.subEquipment,
    brandName: row.brandName,
    supplierName: row.supplierName,
    docketNo: row.docketNo,
    vehicleNo: row.vehicleNo,
    identityNo: row.identityNo,
    odometer: row.odometer === null ? null : Math.round(row.odometer),
    quantity: row.quantity.toString(),
    exRate: row.exRate?.toString() ?? null,
    priceKwacha: row.priceKwacha.toString(),
    amountKwacha: row.amountKwacha?.toString() ?? null,
    priceUsd: row.priceUsd?.toString() ?? null,
    amountUsd: row.amountUsd?.toString() ?? null,
    outwardDate: toIsoDateString(row.outwardDate),
    jobCardNo: row.jobCardNo,
    issuedBy: row.issuedBy,
    collectedBy: row.collectedBy,
    returnQuantity: row.returnQuantity?.toString() ?? null,
    installationPoint: row.installationPoint,
  }
}

// Matches `mapDictionaryRow`'s own key in src/actions/dictionary-seed.ts, so
// a CSV row's Part Number resolves to the same dictionary entry regardless
// of casing or stray whitespace coming off the ERP export.
function normalizeDictionaryPartNumber(partNumber: string) {
  return partNumber.trim().toUpperCase()
}

type DictionaryTaxonomy = {
  tier1: string | null
  tier2: string | null
  tier3: string | null
  assetClass: string | null
}

// Looks up every distinct Part Number in a batch against
// `masterTaxonomyDictionaryTable` in a single query, keyed by the same
// normalized form the dictionary itself is seeded with.
async function lookupDictionaryTaxonomy(partNumbers: string[]) {
  const uniquePartNumbers = [
    ...new Set(partNumbers.map(normalizeDictionaryPartNumber)),
  ]

  if (uniquePartNumbers.length === 0) {
    return new Map<string, DictionaryTaxonomy>()
  }

  const entries = await db
    .select({
      partNumber: masterTaxonomyDictionaryTable.partNumber,
      tier1: masterTaxonomyDictionaryTable.tier1,
      tier2: masterTaxonomyDictionaryTable.tier2,
      tier3: masterTaxonomyDictionaryTable.tier3,
      assetClass: masterTaxonomyDictionaryTable.assetClass,
    })
    .from(masterTaxonomyDictionaryTable)
    .where(inArray(masterTaxonomyDictionaryTable.partNumber, uniquePartNumbers))

  return new Map(entries.map((entry) => [entry.partNumber, entry] as const))
}

// The mileage/telemetry export is a "tall" report: each row is a single
// metric reading for one asset on one date ("Miloto_No", "Date", "Metric",
// "Value") rather than one row per odometer reading, and carries metrics
// `ingestMileage` doesn't care about (engine hours, fuel level, …) alongside
// the "KM" ones that belong in `mileageLogsTable`. This only validates the
// row's shape; `ingestMileage` filters down to the "KM" rows afterwards, so
// a mistyped Miloto_No on an engine-hours row would otherwise register an
// asset that's never actually used.
const mileageSchema = z.preprocess((row) => {
  const cells = indexRowByHeader(row)

  return {
    // Same canonicalization the "Identity No" column goes through for
    // spares (see `sparesRowSchema`), so a Miloto_No here resolves to the
    // same `assetsTable.assetName` those imports create.
    fleetNumber: toCanonicalFleetNumber(
      toTrimmedString(cells.get("miloto_no") ?? cells.get("miloto no"))
    ),
    date: parseSpreadsheetDate(cells.get("date")),
    metric: toTrimmedString(cells.get("metric")),
    value: toNumber(cells.get("value")),
  }
}, z.object({
  fleetNumber: z
    .string()
    .min(1, "Miloto_No is required")
    // Mirrors the `asset_name` varchar width in `src/db/schema.ts`.
    .max(255, "Miloto_No must be 255 characters or fewer"),
  date: z.date({ error: "Date must be a valid date (DD/MM/YYYY)" }),
  metric: z.string().min(1, "Metric is required"),
  value: z.number("Value must be a number"),
}))

type MileageCsvRow = z.infer<typeof mileageSchema>

function toMileageInsertValues(
  row: MileageCsvRow,
  assetIdByFleetNumber: Map<string, number>
) {
  return {
    assetId: assetIdByFleetNumber.get(row.fleetNumber)!,
    date: toIsoDateString(row.date),
    odometer: row.value.toString(),
  }
}

// Bulk-imports the fleet asset list into `assetsTable`. Re-importing is safe:
// existing fleet numbers are left untouched.
export async function ingestAssets(input: IngestInput): Promise<IngestResult> {
  await requireAdmin()

  const { rows, firstRowNumber } = ingestInputSchema.parse(input)
  const { valid, skipped } = partitionRows(rows, assetRowSchema, firstRowNumber)

  let imported = 0

  for (const batch of chunk(valid, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(assetsTable)
      .values(batch)
      .onConflictDoNothing({ target: assetsTable.assetName })
      .returning({ id: assetsTable.id })

    imported += inserted.length
  }

  revalidatePath("/spares-history")

  return {
    imported,
    duplicates: valid.length - imported,
    skipped,
    createdAssets: [],
  }
}

// Bulk-imports the "Job Cards OutWard Report" into `mechanicalSparesTable`.
// Every row's Part Number is checked against `masterTaxonomyDictionaryTable`
// first: a match is inserted straight into `mechanicalSparesTable` with the
// dictionary's canonical tiers/asset class (and the CSV "Sub Equipment"
// cell stored separately on `subEquipment`, never used as a tier
// fallback). Anything that doesn't match is diverted into
// `unmappedSparesStagingTable` for a human to classify from the Triage
// Inbox (src/components/triage-inbox.tsx) rather than being written with
// no — or guessed — taxonomy.
export async function ingestSpares(input: IngestInput): Promise<IngestResult> {
  await requireAdmin()

  const { rows, firstRowNumber } = ingestInputSchema.parse(input)
  const { valid, skipped } = partitionRows(rows, sparesRowSchema, firstRowNumber)

  if (valid.length === 0) {
    return { imported: 0, duplicates: 0, skipped, createdAssets: [] }
  }

  const { assetIdByFleetNumber, createdFleetNumbers } =
    await resolveAssetIdsByFleetNumber(valid.map((row) => row.fleetNumber))

  const dictionaryByPartNumber = await lookupDictionaryTaxonomy(
    valid.map((row) => row.partNumber)
  )

  const matched: { row: SparesRow; taxonomy: DictionaryTaxonomy }[] = []
  const unmatched: SparesRow[] = []

  for (const row of valid) {
    const taxonomy = dictionaryByPartNumber.get(
      normalizeDictionaryPartNumber(row.partNumber)
    )

    if (taxonomy) {
      matched.push({ row, taxonomy })
    } else {
      unmatched.push(row)
    }
  }

  let importedToMechanical = 0

  for (const batch of chunk(matched, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(mechanicalSparesTable)
      .values(
        batch.map(({ row, taxonomy }) =>
          toSpareInsertValues(row, assetIdByFleetNumber, {
            // Dictionary only — never the CSV Sub Equipment/Category
            // columns. Empty string satisfies the NOT NULL tiers when a
            // dictionary row left a level blank.
            tier1: taxonomy.tier1 ?? "",
            tier2: taxonomy.tier2 ?? "",
            tier3: taxonomy.tier3 ?? "",
            assetClass: taxonomy.assetClass,
          })
        )
      )
      // Skips lines already on file, per the unique index over job card,
      // part number and outward date.
      .onConflictDoNothing({
        target: [
          mechanicalSparesTable.jobCardNo,
          mechanicalSparesTable.partNumber,
          mechanicalSparesTable.outwardDate,
        ],
      })
      .returning({ id: mechanicalSparesTable.id })

    importedToMechanical += inserted.length
  }

  let importedToStaging = 0

  for (const batch of chunk(unmatched, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(unmappedSparesStagingTable)
      .values(
        batch.map((row) => toStagingInsertValues(row, assetIdByFleetNumber))
      )
      // Mirrors `mechanicalSparesTable`'s own unique index, so re-uploading
      // the same CSV tops up rather than re-staging a part that's already
      // awaiting triage.
      .onConflictDoNothing({
        target: [
          unmappedSparesStagingTable.jobCardNo,
          unmappedSparesStagingTable.partNumber,
          unmappedSparesStagingTable.outwardDate,
        ],
      })
      .returning({ id: unmappedSparesStagingTable.id })

    importedToStaging += inserted.length
  }

  revalidatePath("/spares-history")
  revalidatePath("/data-ingestion")

  return {
    imported: importedToMechanical + importedToStaging,
    duplicates: valid.length - importedToMechanical - importedToStaging,
    skipped,
    createdAssets: createdFleetNumbers,
    divertedToTriage: importedToStaging,
  }
}

// Bulk-imports the mileage/telemetry export into `mileageLogsTable`.
// Readings already on file for an asset/date are skipped, per the unique
// index in `src/db/schema.ts`, so a re-run tops up rather than failing.
export async function ingestMileage(input: IngestInput): Promise<IngestResult> {
  await requireAdmin()

  const { rows, firstRowNumber } = ingestInputSchema.parse(input)
  const { valid: parsedRows, skipped } = partitionRows(
    rows,
    mileageSchema,
    firstRowNumber
  )

  // The export carries one row per metric per asset/date, not one row per
  // odometer reading — only the "KM" rows (e.g. "KM Reading") are mileage.
  // The rest (engine hours, fuel level, …) are well-formed rows that just
  // don't belong in `mileageLogsTable`, so they're dropped here rather than
  // reported as skipped, which is reserved for rows that failed validation.
  const valid = parsedRows.filter((row) =>
    row.metric.toUpperCase().startsWith("KM")
  )

  if (valid.length === 0) {
    return { imported: 0, duplicates: 0, skipped, createdAssets: [] }
  }

  const { assetIdByFleetNumber, createdFleetNumbers } =
    await resolveAssetIdsByFleetNumber(valid.map((row) => row.fleetNumber))

  let imported = 0

  for (const batch of chunk(valid, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(mileageLogsTable)
      .values(
        batch.map((row) => toMileageInsertValues(row, assetIdByFleetNumber))
      )
      .onConflictDoNothing({
        target: [mileageLogsTable.assetId, mileageLogsTable.date],
      })
      .returning({ id: mileageLogsTable.id })

    imported += inserted.length
  }

  revalidatePath("/spares-history")

  return {
    imported,
    duplicates: valid.length - imported,
    skipped,
    createdAssets: createdFleetNumbers,
  }
}

function toOilConsumptionInsertValues(
  row: OilConsumptionRow,
  assetIdByFleetNumber: Map<string, number>
) {
  return {
    assetId: assetIdByFleetNumber.get(row.fleetNumber)!,
    recordDate: row.recordDate,
    quantity: row.quantity,
    jobCardNo: row.jobCardNo,
  }
}

// Bulk-imports oil consumption rows into `oilConsumptionLogsTable`. Lines
// already on file for the same asset, job card and date are skipped, per the
// unique index in `src/db/schema.ts`, so a re-run tops up rather than failing.
export async function ingestOils(input: IngestInput): Promise<IngestResult> {
  await requireAdmin()

  const { rows, firstRowNumber } = ingestInputSchema.parse(input)
  const { valid, skipped } = partitionRows(
    rows,
    oilConsumptionRowSchema,
    firstRowNumber
  )

  if (valid.length === 0) {
    return { imported: 0, duplicates: 0, skipped, createdAssets: [] }
  }

  const { assetIdByFleetNumber, createdFleetNumbers } =
    await resolveAssetIdsByFleetNumber(valid.map((row) => row.fleetNumber))

  let imported = 0

  for (const batch of chunk(valid, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(oilConsumptionLogsTable)
      .values(
        batch.map((row) =>
          toOilConsumptionInsertValues(row, assetIdByFleetNumber)
        )
      )
      .onConflictDoNothing({
        target: [
          oilConsumptionLogsTable.assetId,
          oilConsumptionLogsTable.jobCardNo,
          oilConsumptionLogsTable.recordDate,
        ],
      })
      .returning({ id: oilConsumptionLogsTable.id })

    imported += inserted.length
  }

  revalidatePath("/data-ingestion")
  revalidatePath("/oils-and-servicing")

  return {
    imported,
    duplicates: valid.length - imported,
    skipped,
    createdAssets: createdFleetNumbers,
  }
}

type MonthlyPairingInsert = {
  trailerId: number
  truckId: number
  driverId: number
  activeMonth: string
  rowNumber: number
}

// Bulk-imports the monthly truck-trailer-driver pairing CSV into
// `monthlyPairingsTable`. Drivers are registered first (existing names are
// left as they are). Trailer and Truck cells are canonical fleet numbers
// looked up on `assetsTable`; a row whose trailer or truck is not on the
// fleet list is skipped. Re-importing the same trailer and month overwrites
// that pairing's truck and driver.
export async function ingestMonthlyPairings(
  input: IngestInput
): Promise<IngestResult> {
  await requireAdmin()

  const { rows, firstRowNumber } = ingestInputSchema.parse(input)
  const valid: { data: PairingRow; rowNumber: number }[] = []
  const skipped: SkippedRow[] = []

  for (const [index, row] of rows.entries()) {
    const parsed = pairingRowSchema.safeParse(row)

    if (parsed.success) {
      valid.push({ data: parsed.data, rowNumber: firstRowNumber + index })
    } else {
      skipped.push({
        rowNumber: firstRowNumber + index,
        error: parsed.error.issues[0]?.message ?? "Row could not be validated",
      })
    }
  }

  if (valid.length === 0) {
    return { imported: 0, duplicates: 0, skipped, createdAssets: [] }
  }

  const driverNames = [...new Set(valid.map(({ data }) => data.driver))]

  for (const batch of chunk(driverNames, INSERT_CHUNK_SIZE)) {
    await db
      .insert(driversTable)
      .values(batch.map((name) => ({ name })))
      .onConflictDoNothing({ target: driversTable.name })
  }

  const driverIdByName = new Map<string, number>()

  for (const batch of chunk(driverNames, INSERT_CHUNK_SIZE)) {
    const drivers = await db
      .select({ id: driversTable.id, name: driversTable.name })
      .from(driversTable)
      .where(inArray(driversTable.name, batch))

    for (const driver of drivers) {
      driverIdByName.set(driver.name, driver.id)
    }
  }

  const fleetNumbers = [
    ...new Set(
      valid.flatMap(({ data }) => [
        toCanonicalFleetNumber(data.trailer),
        toCanonicalFleetNumber(data.truck),
      ])
    ),
  ]
  const assetIdByFleetNumber = new Map<string, number>()

  for (const batch of chunk(fleetNumbers, INSERT_CHUNK_SIZE)) {
    const assets = await selectAssetsByName(batch)

    for (const asset of assets) {
      assetIdByFleetNumber.set(asset.assetName, asset.id)
    }
  }

  const matched: MonthlyPairingInsert[] = []

  for (const { data, rowNumber } of valid) {
    const trailerFleetNumber = toCanonicalFleetNumber(data.trailer)
    const truckFleetNumber = toCanonicalFleetNumber(data.truck)
    const trailerId = assetIdByFleetNumber.get(trailerFleetNumber)
    const truckId = assetIdByFleetNumber.get(truckFleetNumber)
    const driverId = driverIdByName.get(data.driver)

    if (trailerId === undefined) {
      skipped.push({
        rowNumber,
        error: `No fleet asset found for trailer ${data.trailer}`,
      })
      continue
    }

    if (truckId === undefined) {
      skipped.push({
        rowNumber,
        error: `No fleet asset found for truck ${data.truck}`,
      })
      continue
    }

    if (driverId === undefined) {
      skipped.push({
        rowNumber,
        error: `No driver found for ${data.driver}`,
      })
      continue
    }

    matched.push({
      trailerId,
      truckId,
      driverId,
      activeMonth: data.activeMonth,
      rowNumber,
    })
  }

  // One INSERT cannot update the same (trailer, month) twice. A later row
  // in the file wins; the earlier one is reported as skipped.
  const byTrailerMonth = new Map<string, MonthlyPairingInsert>()

  for (const pairing of matched) {
    const key = `${pairing.trailerId}:${pairing.activeMonth}`
    const previous = byTrailerMonth.get(key)

    if (previous) {
      skipped.push({
        rowNumber: previous.rowNumber,
        error: "A later row in this file pairs the same trailer for this month",
      })
    }

    byTrailerMonth.set(key, pairing)
  }

  const pairings = [...byTrailerMonth.values()]
  let imported = 0

  for (const batch of chunk(pairings, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(monthlyPairingsTable)
      .values(
        batch.map(({ trailerId, truckId, driverId, activeMonth }) => ({
          trailerId,
          truckId,
          driverId,
          activeMonth,
        }))
      )
      // Unique index `monthly_pairings_trailer_id_active_month_idx`.
      .onConflictDoUpdate({
        target: [
          monthlyPairingsTable.trailerId,
          monthlyPairingsTable.activeMonth,
        ],
        set: {
          truckId: sql`excluded.truck_id`,
          driverId: sql`excluded.driver_id`,
        },
      })
      .returning({ id: monthlyPairingsTable.id })

    imported += inserted.length
  }

  skipped.sort((a, b) => a.rowNumber - b.rowNumber)

  revalidatePath("/data-ingestion")

  return {
    imported,
    duplicates: 0,
    skipped,
    createdAssets: [],
  }
}

const uploadTirePenaltiesSchema = z.object({
  csvText: z.string().min(1, "CSV file is required"),
})

export type UploadTirePenaltiesInput = z.infer<typeof uploadTirePenaltiesSchema>

function toTirePenaltyInsertValues(
  row: TirePenaltyRow,
  assetIdByFleetNumber: Map<string, number>
) {
  return {
    assetId: assetIdByFleetNumber.get(row.fleetNumber)!,
    amount: row.penaltyPoints,
    date: row.scrapDate,
    reason: row.reason,
    visualId: row.visualId,
  }
}

// Bulk-imports processed tire-scrapping penalties into `tirePenaltiesTable`.
// The client reads the uploaded CSV and passes its text; rows with 0 penalty
// points are dropped (we only store actual deductions). An Asset ID that
// does not match `assetsTable.assetName` is reported as skipped rather than
// registered as a new fleet unit. Re-importing the same Visual Id is a no-op.
export async function uploadTirePenalties(
  input: UploadTirePenaltiesInput
): Promise<IngestResult> {
  await requireAdmin()

  const { csvText } = uploadTirePenaltiesSchema.parse(input)
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  })

  const fatalParseError = parsed.errors.find(
    (error) => error.type === "Quotes" || error.type === "Delimiter"
  )

  if (fatalParseError) {
    throw new Error(
      fatalParseError.row !== undefined
        ? `CSV could not be parsed at row ${fatalParseError.row + 1}: ${fatalParseError.message}`
        : `CSV could not be parsed: ${fatalParseError.message}`
    )
  }

  const rows = parsed.data.filter(isPopulatedCsvRow)
  // Row 1 of the sheet is the header, so the first data row is row 2.
  const firstRowNumber = 2
  const valid: { data: TirePenaltyRow; rowNumber: number }[] = []
  const skipped: SkippedRow[] = []

  for (const [index, row] of rows.entries()) {
    const rowNumber = firstRowNumber + index
    const parsedRow = tirePenaltyRowSchema.safeParse(row)

    if (!parsedRow.success) {
      skipped.push({
        rowNumber,
        error: parsedRow.error.issues[0]?.message ?? "Row could not be validated",
      })
      continue
    }

    // Zero-point lines are well-formed rows that just are not deductions.
    if (parsedRow.data.penaltyPoints === 0) continue

    valid.push({ data: parsedRow.data, rowNumber })
  }

  if (valid.length === 0) {
    return { imported: 0, duplicates: 0, skipped, createdAssets: [] }
  }

  const fleetNumbers = [...new Set(valid.map(({ data }) => data.fleetNumber))]
  const assetIdByFleetNumber = new Map<string, number>()

  for (const batch of chunk(fleetNumbers, INSERT_CHUNK_SIZE)) {
    const assets = await selectAssetsByName(batch)

    for (const asset of assets) {
      assetIdByFleetNumber.set(asset.assetName, asset.id)
    }
  }

  const matched: TirePenaltyRow[] = []

  for (const { data, rowNumber } of valid) {
    if (!assetIdByFleetNumber.has(data.fleetNumber)) {
      skipped.push({
        rowNumber,
        error: `No fleet asset found for Asset ID ${data.fleetNumber}`,
      })
      continue
    }

    matched.push(data)
  }

  let imported = 0

  for (const batch of chunk(matched, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(tirePenaltiesTable)
      .values(
        batch.map((row) => toTirePenaltyInsertValues(row, assetIdByFleetNumber))
      )
      .onConflictDoNothing({ target: tirePenaltiesTable.visualId })
      .returning({ id: tirePenaltiesTable.id })

    imported += inserted.length
  }

  skipped.sort((a, b) => a.rowNumber - b.rowNumber)

  revalidatePath("/logistics")
  revalidatePath("/data-ingestion")

  return {
    imported,
    duplicates: matched.length - imported,
    skipped,
    createdAssets: [],
  }
}

const uploadAlignmentsSchema = z.object({
  csvText: z.string().min(1, "CSV file is required"),
})

export type UploadAlignmentsInput = z.infer<typeof uploadAlignmentsSchema>

function toAlignmentInsertValues(
  row: AlignmentRow,
  assetIdByFleetNumber: Map<string, number>
) {
  return {
    assetId: assetIdByFleetNumber.get(row.fleetNumber)!,
    date: toIsoDateString(row.date),
    // Hardcoded: this importer only ever injects wheel alignments into the
    // executive statement — see `manualAlignmentEventsTable` in
    // src/db/schema.ts for the other event types (checks OK / pending),
    // which are added one at a time via `createManualStatementEvent`.
    eventType: "WHEEL_ALIGNMENT" as const,
  }
}

// Bulk-imports the "Upload Alignments CSV" file into
// `manualAlignmentEventsTable` so wheel alignments appear on the Executive
// Spare Statement alongside physical spare replacements. The file has two
// columns — DATE (YYYY-MM-DD) and Identity No (e.g. "MTL01") — and every row
// becomes a WHEEL_ALIGNMENT event. Unlike `ingestSpares`/`ingestMileage`, an
// Identity No that doesn't match an existing `assetsTable.assetName` is
// skipped rather than registering a new asset, since this file carries no
// asset type to classify it with. Re-uploading the same file is a no-op: the
// unique index on (asset, date, event type) in `src/db/schema.ts` makes a
// repeat row a duplicate rather than a second alignment.
export async function ingestAlignments(
  input: UploadAlignmentsInput
): Promise<IngestResult> {
  await requireAdmin()

  const { csvText } = uploadAlignmentsSchema.parse(input)
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
  })

  const fatalParseError = parsed.errors.find(
    (error) => error.type === "Quotes" || error.type === "Delimiter"
  )

  if (fatalParseError) {
    throw new Error(
      fatalParseError.row !== undefined
        ? `CSV could not be parsed at row ${fatalParseError.row + 1}: ${fatalParseError.message}`
        : `CSV could not be parsed: ${fatalParseError.message}`
    )
  }

  const rows = parsed.data.filter(isPopulatedCsvRow)
  // Row 1 of the sheet is the header, so the first data row is row 2.
  const firstRowNumber = 2
  // Tracked alongside each parsed row (rather than via `partitionRows`,
  // whose returned `valid` array no longer lines up with the original CSV
  // row positions) so a row that fails the asset lookup below still gets
  // reported against the correct spreadsheet row number.
  const valid: { data: AlignmentRow; rowNumber: number }[] = []
  const skipped: SkippedRow[] = []

  for (const [index, row] of rows.entries()) {
    const rowNumber = firstRowNumber + index
    const parsedRow = alignmentRowSchema.safeParse(row)

    if (!parsedRow.success) {
      skipped.push({
        rowNumber,
        error: parsedRow.error.issues[0]?.message ?? "Row could not be validated",
      })
      continue
    }

    valid.push({ data: parsedRow.data, rowNumber })
  }

  if (valid.length === 0) {
    return { imported: 0, duplicates: 0, skipped, createdAssets: [] }
  }

  const fleetNumbers = [...new Set(valid.map(({ data }) => data.fleetNumber))]
  const assetIdByFleetNumber = new Map<string, number>()

  for (const batch of chunk(fleetNumbers, INSERT_CHUNK_SIZE)) {
    const assets = await selectAssetsByName(batch)

    for (const asset of assets) {
      assetIdByFleetNumber.set(asset.assetName, asset.id)
    }
  }

  const matched: AlignmentRow[] = []

  for (const { data, rowNumber } of valid) {
    if (!assetIdByFleetNumber.has(data.fleetNumber)) {
      skipped.push({
        rowNumber,
        error: `No fleet asset found for Identity No ${data.fleetNumber}`,
      })
      continue
    }

    matched.push(data)
  }

  let imported = 0

  for (const batch of chunk(matched, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(manualAlignmentEventsTable)
      .values(
        batch.map((row) => toAlignmentInsertValues(row, assetIdByFleetNumber))
      )
      // Unique index `manual_alignment_events_asset_date_type_idx` — skips a
      // row whose asset, date and event type are already on file so the
      // same CSV can be re-uploaded without double-counting.
      .onConflictDoNothing({
        target: [
          manualAlignmentEventsTable.assetId,
          manualAlignmentEventsTable.date,
          manualAlignmentEventsTable.eventType,
        ],
      })
      .returning({ id: manualAlignmentEventsTable.id })

    imported += inserted.length
  }

  skipped.sort((a, b) => a.rowNumber - b.rowNumber)

  revalidatePath("/spares-history")

  return {
    imported,
    duplicates: matched.length - imported,
    skipped,
    createdAssets: [],
  }
}

function revalidateOilSamplePaths() {
  revalidatePath("/data-ingestion")
  revalidatePath("/oils-and-servicing")
  revalidatePath("/oils-and-servicing/pipeline")
  revalidatePath("/oils-servicing/pipeline")
}

const requestOilSampleSchema = z.object({
  assetId: z.number({ error: "Asset is required" }).int().positive(),
})

export type RequestOilSampleInput = z.infer<typeof requestOilSampleSchema>

export type RequestOilSampleResult = {
  id: string
  fleetNumber: string
}

// Zero-input request from the Oils & Servicing dashboard. Mileage is not
// captured here — `advanceSampleStatus` stamps the latest odometer when
// the sample is marked `drawn`.
export async function requestOilSample(
  input: RequestOilSampleInput
): Promise<RequestOilSampleResult> {
  await requireOilSampleAccess()

  const data = requestOilSampleSchema.parse(input)

  const [asset] = await db
    .select({ id: assetsTable.id, assetName: assetsTable.assetName })
    .from(assetsTable)
    .where(eq(assetsTable.id, data.assetId))
    .limit(1)

  if (!asset) {
    throw new Error("No fleet asset found for this sample request.")
  }

  const [inserted] = await db
    .insert(oilSamplesTable)
    .values({
      assetId: asset.id,
      status: "requested",
      odometer: null,
      drawnDate: null,
    })
    .returning({ id: oilSamplesTable.id })

  if (!inserted) {
    throw new Error("Failed to request oil sample")
  }

  revalidateOilSamplePaths()

  return { id: inserted.id, fleetNumber: asset.assetName }
}

const SAMPLE_STATUSES = ["requested", "drawn", "sent", "received"] as const

type SampleStatus = (typeof SAMPLE_STATUSES)[number]

const NEXT_SAMPLE_STATUS: Record<
  Exclude<SampleStatus, "received">,
  Exclude<SampleStatus, "requested">
> = {
  requested: "drawn",
  drawn: "sent",
  sent: "received",
}

const advanceSampleStatusSchema = z.object({
  sampleId: z.string().uuid("Sample id must be a valid UUID"),
  assetId: z
    .string()
    .trim()
    .min(1, "Asset is required")
    .regex(/^\d+$/, "Asset id must be a number"),
  currentStatus: z.enum(SAMPLE_STATUSES),
})

function toOdometerInteger(value: string) {
  const km = Number(value)

  if (!Number.isFinite(km)) {
    throw new Error("Latest mileage reading is not a valid number")
  }

  return Math.round(km)
}

async function latestOdometerUpToToday(assetId: number) {
  const today = format(new Date(), "yyyy-MM-dd")

  const [reading] = await db
    .select({ odometer: mileageLogsTable.odometer })
    .from(mileageLogsTable)
    .where(
      and(eq(mileageLogsTable.assetId, assetId), lte(mileageLogsTable.date, today))
    )
    .orderBy(desc(mileageLogsTable.date))
    .limit(1)

  if (!reading) {
    throw new Error(
      "No mileage log found for this asset up to today. Import mileage before marking the sample as drawn."
    )
  }

  return toOdometerInteger(reading.odometer)
}

export type AdvanceSampleStatusResult = {
  id: string
  status: SampleStatus
  odometer: number | null
}

// Advances a pipeline card one step. Requested → drawn pulls the latest
// mileage-log odometer for the asset (on or before today) and stamps
// `drawnDate`. Every step also stamps `updatedAt` so the board can keep
// `received` cards visible for 14 days from the last status change.
export async function advanceSampleStatus(
  sampleId: string,
  assetId: string,
  currentStatus: string
): Promise<AdvanceSampleStatusResult> {
  await requireOilSampleAccess()

  const data = advanceSampleStatusSchema.parse({
    sampleId,
    assetId,
    currentStatus,
  })
  const parsedAssetId = Number(data.assetId)

  if (data.currentStatus === "received") {
    throw new Error("This sample already has results.")
  }

  const nextStatus = NEXT_SAMPLE_STATUS[data.currentStatus]

  const [sample] = await db
    .select({
      id: oilSamplesTable.id,
      assetId: oilSamplesTable.assetId,
      status: oilSamplesTable.status,
    })
    .from(oilSamplesTable)
    .where(eq(oilSamplesTable.id, data.sampleId))
    .limit(1)

  if (!sample) {
    throw new Error("Oil sample not found.")
  }

  if (sample.assetId !== parsedAssetId) {
    throw new Error("This sample does not belong to the given asset.")
  }

  if (sample.status !== data.currentStatus) {
    throw new Error("This sample has already moved. Refresh the pipeline.")
  }

  const odometer =
    data.currentStatus === "requested"
      ? await latestOdometerUpToToday(parsedAssetId)
      : null

  const [updated] = await db
    .update(oilSamplesTable)
    .set(
      data.currentStatus === "requested"
        ? {
            status: nextStatus,
            drawnDate: new Date(),
            odometer,
            updatedAt: new Date(),
          }
        : { status: nextStatus, updatedAt: new Date() }
    )
    .where(
      and(
        eq(oilSamplesTable.id, data.sampleId),
        eq(oilSamplesTable.status, data.currentStatus)
      )
    )
    .returning({
      id: oilSamplesTable.id,
      status: oilSamplesTable.status,
      odometer: oilSamplesTable.odometer,
    })

  if (!updated) {
    throw new Error("Failed to advance sample status.")
  }

  revalidateOilSamplePaths()

  return updated
}

const PREV_SAMPLE_STATUS: Record<
  Exclude<SampleStatus, "requested">,
  SampleStatus
> = {
  received: "sent",
  sent: "drawn",
  drawn: "requested",
}

const reverseSampleStatusSchema = z.object({
  sampleId: z.string().uuid("Sample id must be a valid UUID"),
  currentStatus: z.enum(SAMPLE_STATUSES),
})

export type ReverseSampleStatusResult = {
  id: string
  status: SampleStatus
}

// Moves a pipeline card one step backward. Drawn → requested also clears
// the odometer and drawn date captured when the sample was marked drawn.
export async function reverseSampleStatus(
  sampleId: string,
  currentStatus: string
): Promise<ReverseSampleStatusResult> {
  await requireOilSampleAccess()

  const data = reverseSampleStatusSchema.parse({
    sampleId,
    currentStatus,
  })

  if (data.currentStatus === "requested") {
    throw new Error("This sample is already at the first stage.")
  }

  const previousStatus = PREV_SAMPLE_STATUS[data.currentStatus]

  const [sample] = await db
    .select({
      id: oilSamplesTable.id,
      status: oilSamplesTable.status,
    })
    .from(oilSamplesTable)
    .where(eq(oilSamplesTable.id, data.sampleId))
    .limit(1)

  if (!sample) {
    throw new Error("Oil sample not found.")
  }

  if (sample.status !== data.currentStatus) {
    throw new Error("This sample has already moved. Refresh the pipeline.")
  }

  const [updated] = await db
    .update(oilSamplesTable)
    .set(
      data.currentStatus === "drawn"
        ? {
            status: previousStatus,
            odometer: null,
            drawnDate: null,
            updatedAt: new Date(),
          }
        : { status: previousStatus, updatedAt: new Date() }
    )
    .where(
      and(
        eq(oilSamplesTable.id, data.sampleId),
        eq(oilSamplesTable.status, data.currentStatus)
      )
    )
    .returning({
      id: oilSamplesTable.id,
      status: oilSamplesTable.status,
    })

  if (!updated) {
    throw new Error("Failed to reverse sample status.")
  }

  revalidateOilSamplePaths()

  return updated
}

const deleteSampleRequestSchema = z.object({
  sampleId: z.string().uuid("Sample id must be a valid UUID"),
})

export type DeleteSampleRequestResult = {
  id: string
}

// Cancels a sample that has not yet been drawn by deleting the row.
export async function deleteSampleRequest(
  sampleId: string
): Promise<DeleteSampleRequestResult> {
  await requireOilSampleAccess()

  const data = deleteSampleRequestSchema.parse({ sampleId })

  const [sample] = await db
    .select({
      id: oilSamplesTable.id,
      status: oilSamplesTable.status,
    })
    .from(oilSamplesTable)
    .where(eq(oilSamplesTable.id, data.sampleId))
    .limit(1)

  if (!sample) {
    throw new Error("Oil sample not found.")
  }

  if (sample.status !== "requested") {
    throw new Error("Only requested samples can be cancelled.")
  }

  const [deleted] = await db
    .delete(oilSamplesTable)
    .where(
      and(
        eq(oilSamplesTable.id, data.sampleId),
        eq(oilSamplesTable.status, "requested")
      )
    )
    .returning({ id: oilSamplesTable.id })

  if (!deleted) {
    throw new Error("Failed to cancel sample request.")
  }

  revalidateOilSamplePaths()

  return deleted
}

const deleteOilSampleSchema = z.object({
  id: z.string().uuid("Sample id must be a valid UUID"),
})

export type DeleteOilSampleResult = {
  id: string
}

// Physically removes a Results Received card so staff can clear it before
// the 14-day board archive window. Other statuses keep their existing
// cancel / reverse paths.
export async function deleteOilSample(
  id: string
): Promise<DeleteOilSampleResult> {
  await requireOilSampleAccess()

  const data = deleteOilSampleSchema.parse({ id })

  const [sample] = await db
    .select({
      id: oilSamplesTable.id,
      status: oilSamplesTable.status,
    })
    .from(oilSamplesTable)
    .where(eq(oilSamplesTable.id, data.id))
    .limit(1)

  if (!sample) {
    throw new Error("Oil sample not found.")
  }

  if (sample.status !== "received") {
    throw new Error("Only results-received samples can be deleted from the board.")
  }

  const [deleted] = await db
    .delete(oilSamplesTable)
    .where(
      and(eq(oilSamplesTable.id, data.id), eq(oilSamplesTable.status, "received"))
    )
    .returning({ id: oilSamplesTable.id })

  if (!deleted) {
    throw new Error("Failed to delete oil sample.")
  }

  revalidateOilSamplePaths()

  return deleted
}
