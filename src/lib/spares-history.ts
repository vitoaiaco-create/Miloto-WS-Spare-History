import { and, desc, eq, lte } from "drizzle-orm"

import { db } from "@/db"
import { mileageLogsTable } from "@/db/schema"
import { normalizeSubEquipment, toIsoDateString } from "@/lib/spreadsheet"

// The set of filters the Spares History page can be queried with. All
// fields are optional strings straight out of URL search params — empty
// string / undefined means "no filter" for that field.
export type SparesHistoryFilters = {
  fleetNo?: string
  partNumber?: string
  materialName?: string
  subEquipment?: string
  startDate?: string
  endDate?: string
}

// The spares history runs to thousands of lines, so the page shows nothing
// until the operator narrows it down. Both the query and the page's empty
// state key off this, so they can't disagree about what "unfiltered" means.
export function hasActiveSparesFilters(filters: SparesHistoryFilters) {
  return Object.values(filters).some((value) => Boolean(value?.trim()))
}

export type RunningKm = {
  distance: number
  latestDate: string
}

// A single row as rendered by `SparesTable`, already shaped/derived for
// display (dates formatted upstream isn't done here — components format —
// this just resolves the joined/derived values).
export type SparesHistoryRow = {
  id: number
  fitmentDate: string
  materialName: string
  identityNo: string
  partNumber: string
  subEquipment: string
  quantity: number
  priceUsd: number | null
  amountUsd: number | null
  distance: number | null
  latestDate: string | null
}

// KM the asset has covered since the spare was fitted: newest odometer
// reading minus the reading on (or just before) the outward date. Returns
// null when either log is missing, so the table can render an em dash
// rather than inventing a figure.
//
// `assetId` is the integer FK on `mileageLogsTable` (the spare's already-
// resolved `mechanicalSparesTable.assetId`), not the fleet-number string.
export async function calculateRunningKm(
  assetId: number,
  outwardDate: Date
): Promise<RunningKm | null> {
  const outwardDateIso = toIsoDateString(outwardDate)

  const [[latestLog], [baselineLog]] = await Promise.all([
    db
      .select()
      .from(mileageLogsTable)
      .where(eq(mileageLogsTable.assetId, assetId))
      .orderBy(desc(mileageLogsTable.date))
      .limit(1),
    db
      .select()
      .from(mileageLogsTable)
      .where(
        and(
          eq(mileageLogsTable.assetId, assetId),
          lte(mileageLogsTable.date, outwardDateIso)
        )
      )
      .orderBy(desc(mileageLogsTable.date))
      .limit(1),
  ])

  if (!latestLog || !baselineLog) return null

  return {
    distance: Number(latestLog.odometer) - Number(baselineLog.odometer),
    latestDate: latestLog.date,
  }
}

// Reads `mechanicalSparesTable` (joined to `assetsTable` via the `asset`
// relation from `src/db/relations.ts`) filtered per the Spares History
// filter bar, and enriches each row with the KM covered since fitment
// (`calculateRunningKm` against `mileageLogsTable`).
//
// Ingestion pins the outward report's "Sub Equipment" column to `tier1`
// (see `src/lib/validations.ts`), which is also the value the table
// displays, so the filter matches `tier1` alone. Both sides run through
// `normalizeSubEquipment` because the source file is upper case
// ("AIR SYSTEM") while the filter bar offers title case ("Air System").
export async function getSparesHistory(
  filters: SparesHistoryFilters
): Promise<SparesHistoryRow[]> {
  if (!hasActiveSparesFilters(filters)) return []

  const spares = await db.query.mechanicalSparesTable.findMany({
    where: {
      ...(filters.partNumber
        ? { partNumber: { ilike: `%${filters.partNumber}%` } }
        : {}),
      ...(filters.materialName
        ? { materialName: { ilike: `%${filters.materialName}%` } }
        : {}),
      ...(filters.subEquipment
        ? { tier1: normalizeSubEquipment(filters.subEquipment) }
        : {}),
      ...(filters.startDate || filters.endDate
        ? {
            fitmentDate: {
              ...(filters.startDate ? { gte: filters.startDate } : {}),
              ...(filters.endDate ? { lte: filters.endDate } : {}),
            },
          }
        : {}),
      ...(filters.fleetNo
        ? { asset: { assetName: { ilike: `%${filters.fleetNo}%` } } }
        : {}),
    },
    with: { asset: true },
    orderBy: { fitmentDate: "desc" },
  })

  // Many lines share an asset and outward date, so identical lookups reuse
  // the in-flight `calculateRunningKm` promise instead of hitting the DB
  // twice for the same pair.
  const runningKmByKey = new Map<string, Promise<RunningKm | null>>()

  function runningKmFor(assetId: number, outwardDate: Date) {
    const key = `${assetId}:${toIsoDateString(outwardDate)}`
    const existing = runningKmByKey.get(key)
    if (existing) return existing

    const pending = calculateRunningKm(assetId, outwardDate)
    runningKmByKey.set(key, pending)
    return pending
  }

  // `numeric()` columns come back as strings, and the dollar columns are
  // nullable (the report leaves them blank on some lines), so those stay
  // null rather than becoming 0 — the table renders them as a dash.
  function toNullableNumber(value: string | null) {
    return value === null ? null : Number(value)
  }

  return Promise.all(
    spares.map(async (spare) => {
      const runningKm = await runningKmFor(
        spare.assetId,
        new Date(`${spare.fitmentDate}T00:00:00.000Z`)
      )

      return {
        id: spare.id,
        fitmentDate: spare.fitmentDate,
        materialName: spare.materialName,
        identityNo: spare.asset.assetName,
        partNumber: spare.partNumber,
        subEquipment: spare.tier1,
        quantity: Number(spare.quantity),
        priceUsd: toNullableNumber(spare.priceUsd),
        amountUsd: toNullableNumber(spare.costUsd),
        distance: runningKm?.distance ?? null,
        latestDate: runningKm?.latestDate ?? null,
      }
    })
  )
}
