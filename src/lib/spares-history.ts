import { db } from "@/db"
import { normalizeSubEquipment } from "@/lib/spreadsheet"

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
  runningKm: number | null
}

// Reads `mechanicalSparesTable` (joined to `assetsTable` via the `asset`
// relation from `src/db/relations.ts`) filtered per the Spares History
// filter bar, and enriches each row with the fleet's running KM at the
// time of fitment (derived from `mileageLogsTable`).
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

  const assetIds = [...new Set(spares.map((spare) => spare.assetId))]

  const mileageLogs =
    assetIds.length > 0
      ? await db.query.mileageLogsTable.findMany({
          where: { assetId: { in: assetIds } },
          orderBy: { date: "asc" },
        })
      : []

  const mileageLogsByAsset = new Map<
    number,
    { date: string; odometer: string }[]
  >()
  for (const log of mileageLogs) {
    const existing = mileageLogsByAsset.get(log.assetId)
    if (existing) {
      existing.push(log)
    } else {
      mileageLogsByAsset.set(log.assetId, [log])
    }
  }

  // Mileage logs are ordered ascending by date, so the running KM at
  // fitment time is the odometer reading from the latest log dated at or
  // before the fitment date.
  function findRunningKm(assetId: number, fitmentDate: string) {
    const logs = mileageLogsByAsset.get(assetId)
    if (!logs) return null

    let closest: { date: string; odometer: string } | null = null
    for (const log of logs) {
      if (log.date > fitmentDate) break
      closest = log
    }

    return closest ? Number(closest.odometer) : null
  }

  // `numeric()` columns come back as strings, and the dollar columns are
  // nullable (the report leaves them blank on some lines), so those stay
  // null rather than becoming 0 — the table renders them as a dash.
  function toNullableNumber(value: string | null) {
    return value === null ? null : Number(value)
  }

  return spares.map((spare) => ({
    id: spare.id,
    fitmentDate: spare.fitmentDate,
    materialName: spare.materialName,
    identityNo: spare.asset.assetName,
    partNumber: spare.partNumber,
    subEquipment: spare.tier1,
    quantity: Number(spare.quantity),
    priceUsd: toNullableNumber(spare.priceUsd),
    amountUsd: toNullableNumber(spare.costUsd),
    runningKm: findRunningKm(spare.assetId, spare.fitmentDate),
  }))
}
