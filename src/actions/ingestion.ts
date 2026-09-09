"use server"

import { auth } from "@clerk/nextjs/server"
import { inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { assetsTable, mechanicalSparesTable, mileageLogsTable } from "@/db/schema"
import { inferAssetType, toIsoDateString } from "@/lib/spreadsheet"
import {
  assetRowSchema,
  mileageRowSchema,
  sparesRowSchema,
  type MileageRow,
  type SparesRow,
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
// `mechanicalSparesTable`/`mileageLogsTable` reference it via the numeric
// `assetsTable.id` foreign key. This resolves every fleet number in a batch
// to its `assetId`, registering any that isn't on file yet with the type
// implied by its code.
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

function toSpareInsertValues(
  row: SparesRow,
  assetIdByFleetNumber: Map<string, number>
) {
  return {
    assetId: assetIdByFleetNumber.get(row.fleetNumber)!,
    fitmentDate: toIsoDateString(row.fitmentDate),
    partNumber: row.partNumber,
    materialName: row.materialName,
    jobCardNo: row.jobCardNo,
    // The cost columns are `numeric()`, which Drizzle represents as strings
    // by default (see src/db/schema.ts) — the Zod schema validates them as
    // numbers, so we convert back here.
    quantity: row.quantity.toString(),
    costKwacha: row.costKwacha.toString(),
    priceUsd: row.priceUsd?.toString() ?? null,
    costUsd: row.costUsd?.toString() ?? null,
    tier1: row.tier1,
    tier2: row.tier2,
    tier3: row.tier3,
    installationPoint: row.installationPoint,
  }
}

function toMileageInsertValues(
  row: MileageRow,
  assetIdByFleetNumber: Map<string, number>
) {
  return {
    assetId: assetIdByFleetNumber.get(row.fleetNumber)!,
    date: toIsoDateString(row.date),
    odometer: row.odometer.toString(),
  }
}

// Bulk-imports the fleet asset list into `assetsTable`. Re-importing is safe:
// existing fleet numbers are left untouched.
export async function ingestAssets(input: IngestInput): Promise<IngestResult> {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

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
export async function ingestSpares(input: IngestInput): Promise<IngestResult> {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const { rows, firstRowNumber } = ingestInputSchema.parse(input)
  const { valid, skipped } = partitionRows(rows, sparesRowSchema, firstRowNumber)

  if (valid.length === 0) {
    return { imported: 0, duplicates: 0, skipped, createdAssets: [] }
  }

  const { assetIdByFleetNumber, createdFleetNumbers } =
    await resolveAssetIdsByFleetNumber(valid.map((row) => row.fleetNumber))

  let imported = 0

  for (const batch of chunk(valid, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(mechanicalSparesTable)
      .values(
        batch.map((row) => toSpareInsertValues(row, assetIdByFleetNumber))
      )
      // Skips lines already on file, per the unique index over job card,
      // part number and fitment date.
      .onConflictDoNothing({
        target: [
          mechanicalSparesTable.jobCardNo,
          mechanicalSparesTable.partNumber,
          mechanicalSparesTable.fitmentDate,
        ],
      })
      .returning({ id: mechanicalSparesTable.id })

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

// Bulk-imports the "Daily Mileage Log" into `mileageLogsTable`. Readings
// already on file for an asset/date are skipped, per the unique index in
// `src/db/schema.ts`, so a re-run tops up rather than failing.
export async function ingestMileage(input: IngestInput): Promise<IngestResult> {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const { rows, firstRowNumber } = ingestInputSchema.parse(input)
  const { valid, skipped } = partitionRows(rows, mileageRowSchema, firstRowNumber)

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
