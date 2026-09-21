import "server-only"

import { desc, inArray, sql } from "drizzle-orm"

import { db } from "@/db"
import { mileageLogsTable } from "@/db/schema"
import {
  normalizeSubEquipment,
  toCanonicalFleetNumber,
  toIsoDateString,
} from "@/lib/spreadsheet"

export { sparesHistoryHref } from "@/lib/spares-history-href"

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

type MileageReading = {
  assetId: number
  date: string
  odometer: string
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

function runningKmFromReadings(
  latest: MileageReading | undefined,
  baseline: MileageReading | undefined
): RunningKm | null {
  if (!latest || !baseline) return null

  return {
    distance: Number(latest.odometer) - Number(baseline.odometer),
    latestDate: latest.date,
  }
}

// Newest odometer reading per asset, in one round-trip. `DISTINCT ON (asset_id)`
// plus `ORDER BY asset_id, date DESC` keeps the latest row for each id.
async function loadLatestMileageLogs(assetIds: number[]) {
  const latestByAsset = new Map<number, MileageReading>()
  if (assetIds.length === 0) return latestByAsset

  const rows = await db
    .selectDistinctOn([mileageLogsTable.assetId], {
      assetId: mileageLogsTable.assetId,
      date: mileageLogsTable.date,
      odometer: mileageLogsTable.odometer,
    })
    .from(mileageLogsTable)
    .where(inArray(mileageLogsTable.assetId, assetIds))
    .orderBy(mileageLogsTable.assetId, desc(mileageLogsTable.date))

  for (const row of rows) {
    latestByAsset.set(row.assetId, row)
  }

  return latestByAsset
}

// One baseline reading per unique (asset, outward date): the latest log on
// or before that date. `unnest` feeds every pair in a single statement so
// the table is not queried once per spare row.
async function loadBaselineMileageLogs(
  pairs: { assetId: number; outwardDate: string }[]
) {
  const baselineByPair = new Map<string, MileageReading>()
  if (pairs.length === 0) return baselineByPair

  const assetIdArray = sql`ARRAY[${sql.join(
    pairs.map((pair) => sql`${pair.assetId}`),
    sql`, `
  )}]::int[]`
  const outwardDateArray = sql`ARRAY[${sql.join(
    pairs.map((pair) => sql`${pair.outwardDate}`),
    sql`, `
  )}]::date[]`

  const result = await db.execute<{
    assetId: number
    outwardDate: string
    date: string
    odometer: string
  }>(sql`
    SELECT DISTINCT ON (s.asset_id, s.outward_date)
      s.asset_id AS "assetId",
      s.outward_date AS "outwardDate",
      l.date AS "date",
      l.odometer AS "odometer"
    FROM unnest(${assetIdArray}, ${outwardDateArray})
      AS s(asset_id, outward_date)
    INNER JOIN mileage_logs AS l
      ON l.asset_id = s.asset_id
     AND l.date <= s.outward_date
    ORDER BY s.asset_id, s.outward_date, l.date DESC
  `)

  for (const row of result.rows) {
    baselineByPair.set(`${Number(row.assetId)}:${row.outwardDate}`, {
      assetId: Number(row.assetId),
      date: row.date,
      odometer: row.odometer,
    })
  }

  return baselineByPair
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
  const [latestByAsset, baselineByPair] = await Promise.all([
    loadLatestMileageLogs([assetId]),
    loadBaselineMileageLogs([
      { assetId, outwardDate: toIsoDateString(outwardDate) },
    ]),
  ])

  return runningKmFromReadings(
    latestByAsset.get(assetId),
    baselineByPair.get(`${assetId}:${toIsoDateString(outwardDate)}`)
  )
}

// Reads `mechanicalSparesTable` (joined to `assetsTable` via the `asset`
// relation from `src/db/relations.ts`) filtered per the Spares History
// filter bar, and enriches each row with the KM covered since fitment.
// Mileage is resolved in two batched queries (latest log per asset, then
// baseline log per asset/outward-date), then joined in memory — not once
// per spare row.
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
      // Material Name stays a substring search so "brake" still finds
      // "BRAKE PAD". Asset ID / fleet number is exact: wrapping it in
      // `%…%` made "MT12" match MT120, MT121, MT124, and so on.
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
        ? {
            asset: {
              assetName: toCanonicalFleetNumber(filters.fleetNo),
            },
          }
        : {}),
    },
    with: { asset: true },
    orderBy: { fitmentDate: "desc" },
  })

  const assetIds = [...new Set(spares.map((spare) => spare.assetId))]
  const uniquePairs = new Map<
    string,
    { assetId: number; outwardDate: string }
  >()
  for (const spare of spares) {
    uniquePairs.set(`${spare.assetId}:${spare.fitmentDate}`, {
      assetId: spare.assetId,
      outwardDate: spare.fitmentDate,
    })
  }

  const [latestByAsset, baselineByPair] = await Promise.all([
    loadLatestMileageLogs(assetIds),
    loadBaselineMileageLogs([...uniquePairs.values()]),
  ])

  // `numeric()` columns come back as strings, and the dollar columns are
  // nullable (the report leaves them blank on some lines), so those stay
  // null rather than becoming 0 — the table renders them as a dash.
  function toNullableNumber(value: string | null) {
    return value === null ? null : Number(value)
  }

  return spares.map((spare) => {
    const runningKm = runningKmFromReadings(
      latestByAsset.get(spare.assetId),
      baselineByPair.get(`${spare.assetId}:${spare.fitmentDate}`)
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
}
