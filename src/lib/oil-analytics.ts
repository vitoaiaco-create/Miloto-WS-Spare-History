import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  sql,
  sum,
} from "drizzle-orm"

import { db } from "@/db"
import {
  assetsTable,
  mileageLogsTable,
  oilConsumptionLogsTable,
  oilSamplesTable,
} from "@/db/schema"
import type {
  OilComplianceEvent,
  OilComplianceStatus,
  OilHealthRow,
  OilMetrics,
} from "@/lib/oil-status"
import { toIsoDateString } from "@/lib/spreadsheet"

export type {
  OilComplianceEvent,
  OilComplianceStatus,
  OilHealthRow,
  OilMetrics,
} from "@/lib/oil-status"

// Full oil services on this fleet land at ~35 L or more (sump fill on a
// prime mover). Anything smaller is treated as a top-up for burn-rate.
const SERVICE_QUANTITY_LITERS = 35

// Dual-clock reset: a ≥35 L service or a logged sample keeps the unit
// compliant below 13 000 km, due soon through 15 000 km, and overdue after.
const COMPLIANT_KM_LIMIT = 13_000
const OVERDUE_KM_LIMIT = 15_000

// Engine-bearing units that consume engine oil. Trailers are left out of
// the Oils & Servicing health table — they almost never appear on the
// consumption report and would pad the view with empty dual-clock rows.
const OIL_HEALTH_ASSET_TYPES = ["Prime Mover", "Crane", "Tow Truck"] as const

type MileageReading = {
  assetId: number
  date: string
  odometer: string
}

function toOdometerKm(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null

  const km = typeof value === "number" ? value : Number(value)
  return Number.isFinite(km) ? km : null
}

function burnRateLPer1000Km(
  totalTopUpLiters: number,
  kmSinceLastService: number | null
) {
  if (kmSinceLastService === null || kmSinceLastService <= 0) return null

  return (totalTopUpLiters / kmSinceLastService) * 1000
}

function complianceStatus(kmSinceCompliance: number): OilComplianceStatus {
  if (kmSinceCompliance > OVERDUE_KM_LIMIT) return "overdue"
  if (kmSinceCompliance >= COMPLIANT_KM_LIMIT) return "due_soon"
  return "compliant"
}

function pickLastComplianceEvent(
  latestService: { recordDate: Date; odometer: number | null } | null,
  latestSample: { drawnDate: Date; odometer: number | null } | null
): { lastEvent: OilComplianceEvent; odometer: number | null } | null {
  if (!latestService && !latestSample) return null

  if (!latestService) {
    return {
      lastEvent: "sample",
      odometer: latestSample!.odometer,
    }
  }

  if (!latestSample) {
    return {
      lastEvent: "service",
      odometer: latestService.odometer,
    }
  }

  // The more recent of a ≥35 L service and a logged sample resets the clock.
  // Equal timestamps prefer the sample — its odometer was locked in at draw.
  if (latestSample.drawnDate >= latestService.recordDate) {
    return {
      lastEvent: "sample",
      odometer: latestSample.odometer,
    }
  }

  return {
    lastEvent: "service",
    odometer: latestService.odometer,
  }
}

function toOilMetrics(input: {
  currentOdometer: number | null
  lastService: { recordDate: Date; odometer: number | null } | null
  lastSample: { drawnDate: Date; odometer: number | null } | null
  totalTopUpLiters: number
}): OilMetrics {
  const lastComplianceEvent = pickLastComplianceEvent(
    input.lastService,
    input.lastSample
  )

  const kmSinceCompliance =
    input.currentOdometer !== null &&
    lastComplianceEvent !== null &&
    lastComplianceEvent.odometer !== null
      ? input.currentOdometer - lastComplianceEvent.odometer
      : null

  const kmSinceLastService =
    input.currentOdometer !== null &&
    input.lastService !== null &&
    input.lastService.odometer !== null
      ? input.currentOdometer - input.lastService.odometer
      : null

  return {
    status:
      kmSinceCompliance === null ? null : complianceStatus(kmSinceCompliance),
    kmSinceCompliance,
    burnRate: burnRateLPer1000Km(input.totalTopUpLiters, kmSinceLastService),
    lastEvent: lastComplianceEvent?.lastEvent ?? null,
  }
}

async function loadLatestMileageLog(assetId: number) {
  const [row] = await db
    .select({
      assetId: mileageLogsTable.assetId,
      date: mileageLogsTable.date,
      odometer: mileageLogsTable.odometer,
    })
    .from(mileageLogsTable)
    .where(eq(mileageLogsTable.assetId, assetId))
    .orderBy(desc(mileageLogsTable.date))
    .limit(1)

  return row ?? null
}

async function loadMileageOnOrBefore(assetId: number, at: Date) {
  const [row] = await db
    .select({
      assetId: mileageLogsTable.assetId,
      date: mileageLogsTable.date,
      odometer: mileageLogsTable.odometer,
    })
    .from(mileageLogsTable)
    .where(
      and(
        eq(mileageLogsTable.assetId, assetId),
        lte(mileageLogsTable.date, toIsoDateString(at))
      )
    )
    .orderBy(desc(mileageLogsTable.date))
    .limit(1)

  return row ?? null
}

// Dual-clock oil metrics for one asset. `assetId` is `assetsTable.id` —
// the integer FK shared by mileage logs, oil samples, and consumption
// logs — not the fleet-number string staff type into the UI.
export async function calculateOilMetrics(
  assetId: number
): Promise<OilMetrics> {
  const [currentMileage, lastSample, lastService] = await Promise.all([
    loadLatestMileageLog(assetId),
    db
      .select()
      .from(oilSamplesTable)
      .where(
        and(
          eq(oilSamplesTable.assetId, assetId),
          isNotNull(oilSamplesTable.drawnDate),
          isNotNull(oilSamplesTable.odometer)
        )
      )
      .orderBy(desc(oilSamplesTable.drawnDate))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(oilConsumptionLogsTable)
      .where(
        and(
          eq(oilConsumptionLogsTable.assetId, assetId),
          gte(oilConsumptionLogsTable.quantity, SERVICE_QUANTITY_LITERS)
        )
      )
      .orderBy(desc(oilConsumptionLogsTable.recordDate))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ])

  const [lastServiceMileage, consumedOil] = await Promise.all([
    lastService
      ? loadMileageOnOrBefore(assetId, lastService.recordDate)
      : Promise.resolve(null),
    lastService
      ? db
          .select({ total: sum(oilConsumptionLogsTable.quantity) })
          .from(oilConsumptionLogsTable)
          .where(
            and(
              eq(oilConsumptionLogsTable.assetId, assetId),
              lt(oilConsumptionLogsTable.quantity, SERVICE_QUANTITY_LITERS),
              gt(oilConsumptionLogsTable.recordDate, lastService.recordDate)
            )
          )
          .then((rows) => Number(rows[0]?.total ?? 0))
      : Promise.resolve(0),
  ])

  return toOilMetrics({
    currentOdometer: toOdometerKm(currentMileage?.odometer),
    lastService: lastService
      ? {
          recordDate: lastService.recordDate,
          odometer: toOdometerKm(lastServiceMileage?.odometer),
        }
      : null,
    lastSample:
      lastSample?.drawnDate != null
        ? {
            drawnDate: lastSample.drawnDate,
            odometer: lastSample.odometer,
          }
        : null,
    totalTopUpLiters: Number.isFinite(consumedOil) ? consumedOil : 0,
  })
}

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

async function loadMileageOnOrBeforeDates(
  pairs: { assetId: number; onDate: string }[]
) {
  const byPair = new Map<string, MileageReading>()
  if (pairs.length === 0) return byPair

  const assetIdArray = sql`ARRAY[${sql.join(
    pairs.map((pair) => sql`${pair.assetId}`),
    sql`, `
  )}]::int[]`
  const onDateArray = sql`ARRAY[${sql.join(
    pairs.map((pair) => sql`${pair.onDate}`),
    sql`, `
  )}]::date[]`

  const result = await db.execute<{
    assetId: number
    onDate: string
    date: string
    odometer: string
  }>(sql`
    SELECT DISTINCT ON (s.asset_id, s.on_date)
      s.asset_id AS "assetId",
      s.on_date AS "onDate",
      l.date AS "date",
      l.odometer AS "odometer"
    FROM unnest(${assetIdArray}, ${onDateArray})
      AS s(asset_id, on_date)
    INNER JOIN mileage_logs AS l
      ON l.asset_id = s.asset_id
     AND l.date <= s.on_date
    ORDER BY s.asset_id, s.on_date, l.date DESC
  `)

  for (const row of result.rows) {
    byPair.set(`${Number(row.assetId)}:${row.onDate}`, {
      assetId: Number(row.assetId),
      date: row.date,
      odometer: row.odometer,
    })
  }

  return byPair
}

// Fleet Oils & Servicing table. Latest odometer, last sample, last ≥35 L
// service, matching mileage, and top-up totals are each loaded in one
// round-trip rather than calling `calculateOilMetrics` once per asset.
export async function getFleetOilHealth(): Promise<OilHealthRow[]> {
  const assets = await db
    .select({
      id: assetsTable.id,
      assetName: assetsTable.assetName,
    })
    .from(assetsTable)
    .where(inArray(assetsTable.assetType, [...OIL_HEALTH_ASSET_TYPES]))
    .orderBy(assetsTable.assetName)

  const assetIds = assets.map((asset) => asset.id)

  if (assetIds.length === 0) return []

  const [currentByAsset, lastSamples, lastServices, topUps] = await Promise.all(
    [
      loadLatestMileageLogs(assetIds),
      db
        .selectDistinctOn([oilSamplesTable.assetId], {
          assetId: oilSamplesTable.assetId,
          drawnDate: oilSamplesTable.drawnDate,
          odometer: oilSamplesTable.odometer,
        })
        .from(oilSamplesTable)
        .where(
          and(
            inArray(oilSamplesTable.assetId, assetIds),
            isNotNull(oilSamplesTable.drawnDate),
            isNotNull(oilSamplesTable.odometer)
          )
        )
        .orderBy(oilSamplesTable.assetId, desc(oilSamplesTable.drawnDate)),
      db
        .selectDistinctOn([oilConsumptionLogsTable.assetId], {
          assetId: oilConsumptionLogsTable.assetId,
          recordDate: oilConsumptionLogsTable.recordDate,
        })
        .from(oilConsumptionLogsTable)
        .where(
          and(
            inArray(oilConsumptionLogsTable.assetId, assetIds),
            gte(oilConsumptionLogsTable.quantity, SERVICE_QUANTITY_LITERS)
          )
        )
        .orderBy(
          oilConsumptionLogsTable.assetId,
          desc(oilConsumptionLogsTable.recordDate)
        ),
      db
        .select({
          assetId: oilConsumptionLogsTable.assetId,
          recordDate: oilConsumptionLogsTable.recordDate,
          quantity: oilConsumptionLogsTable.quantity,
        })
        .from(oilConsumptionLogsTable)
        .where(
          and(
            inArray(oilConsumptionLogsTable.assetId, assetIds),
            lt(oilConsumptionLogsTable.quantity, SERVICE_QUANTITY_LITERS)
          )
        ),
    ]
  )

  const lastSampleByAsset = new Map(
    lastSamples.map((sample) => [sample.assetId, sample] as const)
  )
  const lastServiceByAsset = new Map(
    lastServices.map((service) => [service.assetId, service] as const)
  )

  const mileagePairs = lastServices.map((service) => ({
    assetId: service.assetId,
    onDate: toIsoDateString(service.recordDate),
  }))

  const mileageByPair = await loadMileageOnOrBeforeDates(mileagePairs)

  const topUpByAsset = new Map<number, number>()
  for (const topUp of topUps) {
    const lastService = lastServiceByAsset.get(topUp.assetId)
    if (!lastService || topUp.recordDate <= lastService.recordDate) continue

    topUpByAsset.set(
      topUp.assetId,
      (topUpByAsset.get(topUp.assetId) ?? 0) + topUp.quantity
    )
  }

  return assets.map((asset) => {
    const lastSample = lastSampleByAsset.get(asset.id)
    const lastService = lastServiceByAsset.get(asset.id)

    return {
      assetId: asset.id,
      assetName: asset.assetName,
      ...toOilMetrics({
        currentOdometer: toOdometerKm(currentByAsset.get(asset.id)?.odometer),
        lastSample:
          lastSample?.drawnDate != null
            ? {
                drawnDate: lastSample.drawnDate,
                odometer: lastSample.odometer,
              }
            : null,
        lastService: lastService
          ? {
              recordDate: lastService.recordDate,
              odometer: toOdometerKm(
                mileageByPair.get(
                  `${asset.id}:${toIsoDateString(lastService.recordDate)}`
                )?.odometer
              ),
            }
          : null,
        totalTopUpLiters: topUpByAsset.get(asset.id) ?? 0,
      }),
    }
  })
}
