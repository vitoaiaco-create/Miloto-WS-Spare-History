"use server"

import { eq, inArray, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireAdmin } from "@/actions/ingestion"
import { db } from "@/db"
import {
  assetsTable,
  driversTable,
  monthlyAssetPairings,
  manualAlignmentEventsTable,
  monthlyPairingsTable,
  tirePenaltiesTable,
  workshopEvents,
} from "@/db/schema"
import { MANUAL_EVENT_MATERIAL_NAMES } from "@/lib/spares-statement"
import {
  AIR_SYSTEM_TEST_FAILED,
  AIR_SYSTEM_TEST_OK,
  ALIGNMENT_COMPLETED,
  workshopDayStart,
} from "@/lib/workshop-events"
import {
  indexRowByHeader,
  parseSpreadsheetDate,
  spreadsheetHeadersOf,
  toCanonicalFleetNumber,
  toIsoDateString,
  toNumber,
  toTrimmedString,
} from "@/lib/spreadsheet"
import { tirePenaltyRowSchema } from "@/lib/validations"

// Admin Data Ingestion module (src/app/(dashboard)/admin/ingestion/page.tsx).
// Both actions receive CSV rows already parsed client-side (PapaParse,
// `header: true`) and resolve the fleet-number strings in them ("MTL99",
// "MT38") to the numeric `assetsTable.id` that every Logistics scorecard
// relationship joins on. A string that isn't on `assetsTable` is never
// auto-registered — the row is skipped and counted as "unmapped" so a typo
// can't spawn a phantom fleet unit.
//
// These actions only WRITE. They never touch the Logistics scoring/aggregation
// code (src/lib/logistics-scoring.ts, src/actions/logistics.ts), which reads
// `tirePenaltiesTable` and `monthlyPairingsTable`.

const INSERT_CHUNK_SIZE = 500

const csvRowsSchema = z.array(z.record(z.string(), z.unknown()))

export type AdminCsvRows = z.infer<typeof csvRowsSchema>

export type AdminUploadResult = {
  // Rows newly written to the target table.
  inserted: number
  // Valid, fully-mapped rows that were already on file.
  duplicates: number
  // Rows dropped because an asset string isn't on `assetsTable`.
  skippedUnmapped: number
  // The distinct unmapped strings behind `skippedUnmapped`, as typed in the CSV.
  unmappedAssets: string[]
  // Rows dropped because a cell failed validation (bad date, no reason, …).
  skippedInvalid: number
  // First few distinct validation messages, for the toast.
  invalidReasons: string[]
  // Tyre penalties only: rows with Penalty Points == 0, ignored by design.
  filteredZeroPoints: number
  // Pairings only: rows also upserted into `monthlyPairingsTable`, the table
  // the Logistics Asset Rankings actually read.
  mirroredToLogistics: number
}

function emptyResult(): AdminUploadResult {
  return {
    inserted: 0,
    duplicates: 0,
    skippedUnmapped: 0,
    unmappedAssets: [],
    skippedInvalid: 0,
    invalidReasons: [],
    filteredZeroPoints: 0,
    mirroredToLogistics: 0,
  }
}

const MAX_LISTED_INVALID_REASONS = 5

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function assertHeaders(rows: unknown[], required: string[], fileLabel: string) {
  const present = new Set(spreadsheetHeadersOf(rows[0]))
  const missing = required.filter((header) => !present.has(header.toLowerCase()))

  if (missing.length > 0) {
    throw new Error(
      `${fileLabel} is missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`
    )
  }
}

// Resolves canonical fleet numbers to `assetsTable.id` in batches.
async function resolveAssetIds(fleetNumbers: string[]) {
  const idByName = new Map<string, number>()

  for (const batch of chunk([...new Set(fleetNumbers)], INSERT_CHUNK_SIZE)) {
    const assets = await db
      .select({ id: assetsTable.id, assetName: assetsTable.assetName })
      .from(assetsTable)
      .where(inArray(assetsTable.assetName, batch))

    for (const asset of assets) {
      idByName.set(asset.assetName, asset.id)
    }
  }

  return idByName
}

function recordInvalid(result: AdminUploadResult, message: string) {
  result.skippedInvalid += 1

  if (
    result.invalidReasons.length < MAX_LISTED_INVALID_REASONS &&
    !result.invalidReasons.includes(message)
  ) {
    result.invalidReasons.push(message)
  }
}

// ---------------------------------------------------------------------------
// Tyre penalties
// ---------------------------------------------------------------------------

const TYRE_HEADERS = [
  "Visual Id",
  "Scrap Date",
  "Scrap Reason",
  "Penalty Points",
  "Asset ID",
]

// Imports the Python-processed tyre penalties CSV into `tirePenaltiesTable`
// (the table behind the Asset Rankings' tyre-penalty points). Rows with
// `Penalty Points == 0` are filtered out first. Re-importing the same
// `Visual Id` is a no-op (unique index `tire_penalties_visual_id_idx`).
export async function uploadTyrePenalties(
  csvData: AdminCsvRows
): Promise<AdminUploadResult> {
  await requireAdmin()

  const rows = csvRowsSchema.parse(csvData)
  const result = emptyResult()

  if (rows.length === 0) return result

  assertHeaders(rows, TYRE_HEADERS, "Tyre penalties CSV")

  const candidates: { rawAssetId: string; fleetNumber: string; data: z.output<typeof tirePenaltyRowSchema> }[] = []

  for (const row of rows) {
    const cells = indexRowByHeader(row)

    // Filter zero-point lines before validating so a blank cell on a
    // non-deduction row isn't reported as a bad row.
    if (toNumber(cells.get("penalty points")) === 0) {
      result.filteredZeroPoints += 1
      continue
    }

    const parsed = tirePenaltyRowSchema.safeParse(row)

    if (!parsed.success) {
      recordInvalid(
        result,
        parsed.error.issues[0]?.message ?? "Row could not be validated"
      )
      continue
    }

    candidates.push({
      rawAssetId: toTrimmedString(cells.get("asset id")),
      fleetNumber: parsed.data.fleetNumber,
      data: parsed.data,
    })
  }

  if (candidates.length === 0) return result

  const assetIdByName = await resolveAssetIds(
    candidates.map(({ fleetNumber }) => fleetNumber)
  )

  const unmapped = new Set<string>()
  const matched: (typeof tirePenaltiesTable.$inferInsert)[] = []

  for (const { rawAssetId, fleetNumber, data } of candidates) {
    const assetId = assetIdByName.get(fleetNumber)

    if (assetId === undefined) {
      result.skippedUnmapped += 1
      unmapped.add(rawAssetId)
      continue
    }

    matched.push({
      assetId,
      amount: data.penaltyPoints,
      date: data.scrapDate,
      reason: data.reason,
      visualId: data.visualId,
    })
  }

  result.unmappedAssets = [...unmapped]

  for (const batch of chunk(matched, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(tirePenaltiesTable)
      .values(batch)
      .onConflictDoNothing({ target: tirePenaltiesTable.visualId })
      .returning({ id: tirePenaltiesTable.id })

    result.inserted += inserted.length
  }

  result.duplicates = matched.length - result.inserted

  revalidatePath("/logistics")

  return result
}

// ---------------------------------------------------------------------------
// Monthly asset pairings
// ---------------------------------------------------------------------------

const PAIRING_HEADERS = ["Active_Month", "Truck", "Driver", "Trailer"]

// The Python export writes the first of the month ("2026-09-01"), but a bare
// "2026-09" or a day-first date is normalized to the same canonical first of
// the month so one month always lands on one `active_month` value.
function toFirstOfMonth(value: unknown): string | null {
  const raw = toTrimmedString(value)
  const yearMonth = raw.match(/^(\d{4})-(\d{1,2})$/)

  if (yearMonth) {
    const month = Number(yearMonth[2])
    return month >= 1 && month <= 12
      ? `${yearMonth[1]}-${String(month).padStart(2, "0")}-01`
      : null
  }

  const date = parseSpreadsheetDate(raw)
  return date ? `${toIsoDateString(date).slice(0, 7)}-01` : null
}

const pairingCsvRowSchema = z.preprocess(
  (row) => {
    const cells = indexRowByHeader(row)

    return {
      activeMonth: toFirstOfMonth(cells.get("active_month")),
      truck: toTrimmedString(cells.get("truck")),
      trailer: toTrimmedString(cells.get("trailer")),
      driver: toTrimmedString(cells.get("driver")),
    }
  },
  z
    .object({
      activeMonth: z.string({
        error: "Active_Month must be a valid month (YYYY-MM-DD)",
      }),
      truck: z.string().max(255, "Truck must be 255 characters or fewer"),
      trailer: z.string().max(255, "Trailer must be 255 characters or fewer"),
      driver: z.string().max(255, "Driver must be 255 characters or fewer"),
    })
    .refine((row) => row.truck !== "" || row.trailer !== "", {
      message: "Row has neither a Truck nor a Trailer",
    })
)

type ResolvedPairing = {
  activeMonth: string
  truckId: number | null
  trailerId: number | null
  driverName: string | null
}

function pairingKey(pairing: ResolvedPairing) {
  return [
    pairing.activeMonth,
    pairing.truckId ?? "",
    pairing.trailerId ?? "",
    pairing.driverName ?? "",
  ].join("|")
}

// Imports the Python-generated monthly pairings CSV into
// `monthlyAssetPairings`. Truck and Trailer are looked up on `assetsTable`;
// a blank cell is stored as NULL, but a non-blank string that matches no
// asset skips the whole row (never a half-linked pairing). Re-uploading a
// row that is already on file is reported as a duplicate, not inserted twice.
//
// The Logistics Asset Rankings read pairings from `monthlyPairingsTable`
// (trailer + truck + driver, all required), not from `monthlyAssetPairings`.
// So every row that resolves a truck, a trailer AND a driver is also upserted
// there — the same upsert `ingestMonthlyPairings` does — which is what makes
// the uploaded data appear in the scorecards without touching their code.
export async function uploadMonthlyPairings(
  csvData: AdminCsvRows
): Promise<AdminUploadResult> {
  await requireAdmin()

  const rows = csvRowsSchema.parse(csvData)
  const result = emptyResult()

  if (rows.length === 0) return result

  assertHeaders(rows, PAIRING_HEADERS, "Monthly pairings CSV")

  const candidates: z.output<typeof pairingCsvRowSchema>[] = []

  for (const row of rows) {
    const parsed = pairingCsvRowSchema.safeParse(row)

    if (!parsed.success) {
      recordInvalid(
        result,
        parsed.error.issues[0]?.message ?? "Row could not be validated"
      )
      continue
    }

    candidates.push(parsed.data)
  }

  if (candidates.length === 0) return result

  const canonical = (value: string) =>
    value === "" ? null : toCanonicalFleetNumber(value)

  const assetIdByName = await resolveAssetIds(
    candidates.flatMap(({ truck, trailer }) =>
      [canonical(truck), canonical(trailer)].filter(
        (name): name is string => name !== null
      )
    )
  )

  const unmapped = new Set<string>()
  const resolved: ResolvedPairing[] = []

  for (const { activeMonth, truck, trailer, driver } of candidates) {
    const truckName = canonical(truck)
    const trailerName = canonical(trailer)
    const truckId = truckName === null ? null : assetIdByName.get(truckName)
    const trailerId =
      trailerName === null ? null : assetIdByName.get(trailerName)

    const unmappedHere: string[] = []
    if (truckId === undefined) unmappedHere.push(truck)
    if (trailerId === undefined) unmappedHere.push(trailer)

    if (unmappedHere.length > 0) {
      result.skippedUnmapped += 1
      for (const value of unmappedHere) unmapped.add(value)
      continue
    }

    resolved.push({
      activeMonth,
      truckId: truckId ?? null,
      trailerId: trailerId ?? null,
      driverName: driver === "" ? null : driver,
    })
  }

  result.unmappedAssets = [...unmapped]

  if (resolved.length === 0) return result

  // Skip rows already on file (and repeats within this file) so a re-upload
  // is idempotent even though the table has no unique key.
  const months = [...new Set(resolved.map(({ activeMonth }) => activeMonth))]
  const existing = await db
    .select({
      activeMonth: monthlyAssetPairings.activeMonth,
      truckId: monthlyAssetPairings.truckId,
      trailerId: monthlyAssetPairings.trailerId,
      driverName: monthlyAssetPairings.driverName,
    })
    .from(monthlyAssetPairings)
    .where(inArray(monthlyAssetPairings.activeMonth, months))

  const seen = new Set(existing.map(pairingKey))
  const fresh: ResolvedPairing[] = []

  for (const pairing of resolved) {
    const key = pairingKey(pairing)

    if (seen.has(key)) {
      result.duplicates += 1
      continue
    }

    seen.add(key)
    fresh.push(pairing)
  }

  for (const batch of chunk(fresh, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(monthlyAssetPairings)
      .values(batch)
      .returning({ id: monthlyAssetPairings.id })

    result.inserted += inserted.length
  }

  result.mirroredToLogistics = await mirrorToLogisticsPairings(resolved)

  revalidatePath("/logistics")

  return result
}

// Upserts every complete (truck + trailer + driver) pairing into
// `monthlyPairingsTable`, keyed on its unique (trailer, month) index. Mirrors
// all resolved rows, not just newly inserted ones, so a retry after a partial
// failure still completes the sync. Within one file a later row for the same
// trailer and month wins — one INSERT can't update the same key twice.
async function mirrorToLogisticsPairings(pairings: ResolvedPairing[]) {
  const complete = pairings.filter(
    (pairing): pairing is ResolvedPairing & {
      truckId: number
      trailerId: number
      driverName: string
    } =>
      pairing.truckId !== null &&
      pairing.trailerId !== null &&
      pairing.driverName !== null
  )

  if (complete.length === 0) return 0

  const driverNames = [...new Set(complete.map(({ driverName }) => driverName))]
  const driverIdByName = new Map<string, number>()

  for (const batch of chunk(driverNames, INSERT_CHUNK_SIZE)) {
    // Existing drivers are left as they are.
    await db
      .insert(driversTable)
      .values(batch.map((name) => ({ name })))
      .onConflictDoNothing({ target: driversTable.name })

    const drivers = await db
      .select({ id: driversTable.id, name: driversTable.name })
      .from(driversTable)
      .where(inArray(driversTable.name, batch))

    for (const driver of drivers) {
      driverIdByName.set(driver.name, driver.id)
    }
  }

  const byTrailerMonth = new Map<
    string,
    typeof monthlyPairingsTable.$inferInsert
  >()

  for (const { trailerId, truckId, driverName, activeMonth } of complete) {
    const driverId = driverIdByName.get(driverName)
    if (driverId === undefined) continue

    byTrailerMonth.set(`${trailerId}:${activeMonth}`, {
      trailerId,
      truckId,
      driverId,
      activeMonth,
    })
  }

  let mirrored = 0

  for (const batch of chunk([...byTrailerMonth.values()], INSERT_CHUNK_SIZE)) {
    const upserted = await db
      .insert(monthlyPairingsTable)
      .values(batch)
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

    mirrored += upserted.length
  }

  return mirrored
}

// ---------------------------------------------------------------------------
// One-time historical migration: manual_alignment_events -> workshop_events
// ---------------------------------------------------------------------------

const LEGACY_MIGRATION_AUTHOR = "Legacy System Migration"

// Maps a legacy row's event text to the strict `workshop_events` category /
// outcome pair. Returns null for anything else (generic checks / notes),
// which is not migrated. The legacy table stores its text as an enum whose
// printed label is `MANUAL_EVENT_MATERIAL_NAMES[eventType]`
// ("WHEEL ALIGNMENT", "PREVENTATIVE MAINT - AIR SYSTEM TEST FAILED", …).
function mapLegacyEvent(text: string) {
  const upper = text.toUpperCase()

  if (upper.includes("WHEEL ALIGNMENT")) {
    return {
      eventCategory: "Wheel Alignment",
      eventOutcome: ALIGNMENT_COMPLETED,
    }
  }

  // FAILED is tested before OK so a failed test can never be read as passing.
  if (upper.includes("AIR SYSTEM TEST FAILED")) {
    return {
      eventCategory: "Air System Check",
      eventOutcome: AIR_SYSTEM_TEST_FAILED,
    }
  }

  if (upper.includes("AIR SYSTEM TEST OK")) {
    return {
      eventCategory: "Air System Check",
      eventOutcome: AIR_SYSTEM_TEST_OK,
    }
  }

  return null
}

function legacyEventKey(event: {
  assetId: number
  eventCategory: string
  eventOutcome: string
  createdAt: Date
}) {
  return [
    event.assetId,
    event.eventCategory,
    event.eventOutcome,
    event.createdAt.getTime(),
  ].join("|")
}

// Temporary, admin-only. Copies historical wheel alignments and air system
// checks from `manual_alignment_events` (what `getStatementManualEvents`
// reads) into `workshop_events`. The legacy rows are left untouched.
// Re-running is safe: a row already migrated (same asset, category, outcome
// and date, authored by "Legacy System Migration") is not inserted again.
// Returns the number of rows newly written.
export async function migrateHistoricalEvents(): Promise<number> {
  await requireAdmin()

  const legacyEvents = await db.select().from(manualAlignmentEventsTable)

  const mapped: (typeof workshopEvents.$inferInsert)[] = []

  for (const legacy of legacyEvents) {
    const category = mapLegacyEvent(
      MANUAL_EVENT_MATERIAL_NAMES[legacy.eventType] ?? legacy.eventType
    )
    if (!category) continue

    // Legacy rows only carry a calendar day; anchor it to the start of that
    // workshop day so date-range filters place it on the right day.
    const createdAt = workshopDayStart(legacy.date)
    if (!createdAt) continue

    mapped.push({
      assetId: legacy.assetId,
      ...category,
      createdAt,
      eventDate: createdAt,
      createdBy: LEGACY_MIGRATION_AUTHOR,
    })
  }

  if (mapped.length === 0) return 0

  const alreadyMigrated = await db
    .select({
      assetId: workshopEvents.assetId,
      eventCategory: workshopEvents.eventCategory,
      eventOutcome: workshopEvents.eventOutcome,
      createdAt: workshopEvents.createdAt,
    })
    .from(workshopEvents)
    .where(eq(workshopEvents.createdBy, LEGACY_MIGRATION_AUTHOR))

  const seen = new Set(
    alreadyMigrated.map((event) => legacyEventKey(event))
  )
  const fresh = mapped.filter((event) => {
    const key = legacyEventKey({
      assetId: event.assetId,
      eventCategory: event.eventCategory,
      eventOutcome: event.eventOutcome,
      createdAt: event.createdAt as Date,
    })
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  let migrated = 0

  // Batched so a large history stays under Postgres' bind-parameter limit.
  for (const batch of chunk(fresh, INSERT_CHUNK_SIZE)) {
    const inserted = await db
      .insert(workshopEvents)
      .values(batch)
      .returning({ id: workshopEvents.id })

    migrated += inserted.length
  }

  revalidatePath("/workshop/events")
  revalidatePath("/spares-history")
  revalidatePath("/analytics/event-compliance")

  return migrated
}
