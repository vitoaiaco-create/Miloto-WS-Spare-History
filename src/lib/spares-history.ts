import "server-only"

import { and, between, desc, inArray, not, sql } from "drizzle-orm"

import { db } from "@/db"
import {
  assetsTable,
  mileageLogsTable,
  partDescriptionAliasesTable,
  statementConsumableExclusionsTable,
} from "@/db/schema"
import { toIsoDateParam } from "@/lib/iso-date"
import {
  normalizeSubEquipment,
  toCanonicalFleetNumber,
  toIsoDateString,
} from "@/lib/spreadsheet"
import {
  assetTypesForStatement,
  classifyStatementAssetType,
  MANUAL_EVENT_MATERIAL_NAMES,
  type ManualStatementEventType,
  type PartAliasMap,
  type StatementAssetOption,
  type StatementAssetScope,
  type StatementRowKind,
} from "@/lib/spares-statement"

export { sparesHistoryHref } from "@/lib/spares-history-href"

// The set of filters the Spares History page can be queried with. Text
// fields are optional strings straight out of URL search params — empty
// string / undefined means "no filter" for that field. `subEquipment` is
// every selected category (repeated `subEquipment` search params); an
// empty list means no category filter.
export type SparesHistoryFilters = {
  fleetNo?: string
  // Executive statement Asset ID multi-select. Empty means every unit in
  // the current Truck / Trailer / All group; values are fleet numbers.
  assetIds?: string[]
  partNumber?: string
  materialName?: string
  subEquipment?: string[]
  startDate?: string
  endDate?: string
  // Closed range of outward dates to drop from the table. Kept off the
  // printed report header; the on-screen badge is the only reminder.
  excludeFrom?: string
  excludeTo?: string
  // All / Truck / Trailer scope used by the executive statement. Narrows
  // the joined asset, not a column on the spare itself.
  assetType?: StatementAssetScope
}

function isActiveFilterValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.some((item) => item.trim().length > 0)
  }
  return Boolean(value?.trim())
}

// The spares history runs to thousands of lines, so the page shows nothing
// until the operator narrows it down. Both the query and the page's empty
// state key off this, so they can't disagree about what "unfiltered" means.
export function hasActiveSparesFilters(filters: SparesHistoryFilters) {
  return Object.values(filters).some((value) => isActiveFilterValue(value))
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
  kind?: StatementRowKind
  fitmentDate: string
  materialName: string
  identityNo: string
  partNumber: string
  subEquipment: string
  quantity: number | null
  priceUsd: number | null
  amountUsd: number | null
  distance: number | null
  latestDate: string | null
  notes?: string | null
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

async function loadStatementConsumableExclusionKeys() {
  const rows = await db
    .select({
      partNumber: statementConsumableExclusionsTable.normalizedPartNumber,
      materialName: statementConsumableExclusionsTable.normalizedMaterialName,
    })
    .from(statementConsumableExclusionsTable)

  return {
    partNumbers: [...new Set(rows.map((row) => row.partNumber).filter(Boolean))],
    materialNames: [
      ...new Set(rows.map((row) => row.materialName).filter(Boolean)),
    ],
  }
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
// Several categories at once become `tier1 IN (...)`, which Drizzle
// compiles with `inArray`.
//
// When `excludeStatementConsumables` is set (executive statement only),
// rows whose part number or material name matches
// `statement_consumable_exclusions` are dropped before mileage enrichment.
// The main Spares History table does not pass this option.
export async function getSparesHistory(
  filters: SparesHistoryFilters,
  options?: { excludeStatementConsumables?: boolean }
): Promise<SparesHistoryRow[]> {
  if (!hasActiveSparesFilters(filters)) return []

  const categories = [
    ...new Set(
      (filters.subEquipment ?? [])
        .map((category) => normalizeSubEquipment(category))
        .filter(Boolean)
    ),
  ]

  // Outward date is stored on `fitmentDate`. Both ends are required;
  // `between` is inclusive, so `not(between(...))` drops every day in
  // the range, including the first and last.
  const excludeFromDate = toIsoDateParam(filters.excludeFrom)
  const excludeToDate = toIsoDateParam(filters.excludeTo)
  const [excludeStart, excludeEnd] =
    excludeFromDate && excludeToDate
      ? excludeFromDate <= excludeToDate
        ? [excludeFromDate, excludeToDate]
        : [excludeToDate, excludeFromDate]
      : []

  const consumableExclusions = options?.excludeStatementConsumables
    ? await loadStatementConsumableExclusionKeys()
    : { partNumbers: [] as string[], materialNames: [] as string[] }

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
      ...(categories.length > 0 ? { tier1: { in: categories } } : {}),
      ...(filters.startDate || filters.endDate
        ? {
            fitmentDate: {
              ...(filters.startDate ? { gte: filters.startDate } : {}),
              ...(filters.endDate ? { lte: filters.endDate } : {}),
            },
          }
        : {}),
      ...((excludeStart && excludeEnd) ||
      consumableExclusions.partNumbers.length > 0 ||
      consumableExclusions.materialNames.length > 0
        ? {
            RAW: (table) => {
              const normalizedPartNumber = sql<string>`upper(trim(both from regexp_replace(${table.partNumber}, '\\s+', ' ', 'g')))`
              const normalizedMaterialName = sql<string>`upper(trim(both from regexp_replace(${table.materialName}, '\\s+', ' ', 'g')))`
              const clauses = [
                excludeStart && excludeEnd
                  ? not(between(table.fitmentDate, excludeStart, excludeEnd))
                  : undefined,
                consumableExclusions.partNumbers.length > 0
                  ? not(
                      inArray(
                        normalizedPartNumber,
                        consumableExclusions.partNumbers
                      )
                    )
                  : undefined,
                consumableExclusions.materialNames.length > 0
                  ? not(
                      inArray(
                        normalizedMaterialName,
                        consumableExclusions.materialNames
                      )
                    )
                  : undefined,
              ].filter((clause): clause is NonNullable<typeof clause> =>
                Boolean(clause)
              )

              return and(...clauses) ?? sql`true`
            },
          }
        : {}),
      ...statementAssetFilter(filters),
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
      kind: "spare" as const,
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

function statementAssetFilter(
  filters: Pick<SparesHistoryFilters, "fleetNo" | "assetIds" | "assetType">
) {
  const assetIds = [
    ...new Set(
      (filters.assetIds ?? [])
        .map((id) => toCanonicalFleetNumber(id))
        .filter(Boolean)
    ),
  ]

  if (assetIds.length > 0) {
    return {
      asset: {
        assetName: { in: assetIds },
      },
    }
  }

  if (filters.fleetNo) {
    return {
      asset: {
        assetName: toCanonicalFleetNumber(filters.fleetNo),
      },
    }
  }

  if (!filters.assetType) return {}

  return {
    asset: {
      assetType: {
        in:
          filters.assetType === "All"
            ? [
                ...assetTypesForStatement("Truck"),
                ...assetTypesForStatement("Trailer"),
              ]
            : assetTypesForStatement(filters.assetType),
      },
    },
  }
}

function isManualStatementEventType(
  value: string
): value is ManualStatementEventType {
  return value in MANUAL_EVENT_MATERIAL_NAMES
}

// Manual statement events (alignments, routine checks, checks pending)
// shaped as pseudo spare rows so they sort and export with physical
// replacements. Assets that have only these events and no physical
// spares still get a section.
export async function getStatementManualEvents(
  filters: Pick<
    SparesHistoryFilters,
    "fleetNo" | "assetIds" | "assetType" | "startDate" | "endDate"
  >
): Promise<SparesHistoryRow[]> {
  const events = await db.query.manualAlignmentEventsTable.findMany({
    where: {
      ...(filters.startDate || filters.endDate
        ? {
            date: {
              ...(filters.startDate ? { gte: filters.startDate } : {}),
              ...(filters.endDate ? { lte: filters.endDate } : {}),
            },
          }
        : {}),
      ...statementAssetFilter(filters),
    },
    with: { asset: true },
    orderBy: { date: "desc" },
  })

  return events.map((event) => {
    const eventType = isManualStatementEventType(event.eventType)
      ? event.eventType
      : "WHEEL_ALIGNMENT"

    return {
      id: event.id,
      kind: "manual" as const,
      fitmentDate: event.date,
      materialName: MANUAL_EVENT_MATERIAL_NAMES[eventType],
      identityNo: event.asset.assetName,
      partNumber: "",
      subEquipment: "",
      quantity: null,
      priceUsd: null,
      amountUsd: null,
      distance: null,
      latestDate: null,
      notes: event.notes,
    }
  })
}

export const getStatementAlignmentEvents = getStatementManualEvents

// Fleet units offered in the executive statement's Asset ID dropdown,
// already classified as Truck or Trailer. Unclassified "Other" units stay
// out so the list matches the statement type filter.
export async function getStatementAssets(): Promise<StatementAssetOption[]> {
  const assets = await db
    .select({
      assetName: assetsTable.assetName,
      assetType: assetsTable.assetType,
    })
    .from(assetsTable)
    .orderBy(assetsTable.assetName)

  return assets.flatMap((asset) => {
    const assetType = classifyStatementAssetType(asset.assetType, asset.assetName)
    return assetType ? [{ assetName: asset.assetName, assetType }] : []
  })
}

export async function getPartDescriptionAliases(): Promise<PartAliasMap> {
  const rows = await db
    .select({
      normalizedName: partDescriptionAliasesTable.normalizedName,
      alias: partDescriptionAliasesTable.alias,
    })
    .from(partDescriptionAliasesTable)

  return Object.fromEntries(
    rows.map((row) => [row.normalizedName, row.alias])
  )
}
