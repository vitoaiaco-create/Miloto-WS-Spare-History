import { and, desc, eq, gt, gte, inArray, lt, lte, sql, sum } from "drizzle-orm"

import { db } from "@/db"
import {
  assetsTable,
  mileageLogsTable,
  oilConsumptionLogsTable,
  oilSamplesTable,
} from "@/db/schema"
import { toIsoDateString } from "@/lib/spreadsheet"

// Full oil services on this fleet land at ~35 L or more (sump fill on a
// prime mover). Anything smaller is treated as a top-up for burn-rate.
const SERVICE_QUANTITY_LITERS = 35

// Engine-bearing units that consume engine oil. Trailers are left out of
// the Oils & Servicing health table — they almost never appear on the
// consumption report and would pad the view with empty dual-clock rows.
const OIL_HEALTH_ASSET_TYPES = ["Prime Mover", "Crane", "Tow Truck"] as const

type MileageReading = {
  assetId: number
  date: string
  odometer: string
}

export type OilMetrics = {
  kmSinceLastSample: number | null
  kmSinceLastService: number | null
  totalTopUpLiters: number
  burnRate: number | null
}

export type OilHealthRow = {
  assetId: number
  assetName: string
} & OilMetrics

function kmDelta(
  currentOdometer: MileageReading | null | undefined,
  baselineOdometer: MileageReading | null | undefined
) {
  if (!currentOdometer || !baselineOdometer) return null

  return Number(currentOdometer.odometer) - Number(baselineOdometer.odometer)
}

function burnRateLPer1000Km(
  totalTopUpLiters: number,
  kmSinceLastService: number | null
) {
  if (kmSinceLastService === null || kmSinceLastService <= 0) return null

  return (totalTopUpLiters / kmSinceLastService) * 1000
}

function toOilMetrics(input: {
  currentOdometer: MileageReading | null | undefined
  lastSampleOdometer: MileageReading | null | undefined
  lastServiceOdometer: MileageReading | null | undefined
  totalTopUpLiters: number
}): OilMetrics {
  const kmSinceLastSample = kmDelta(
    input.currentOdometer,
    input.lastSampleOdometer
  )
  const kmSinceLastService = kmDelta(
    input.currentOdometer,
    input.lastServiceOdometer
  )
  const totalTopUpLiters = input.totalTopUpLiters

  return {
    kmSinceLastSample,
    kmSinceLastService,
    totalTopUpLiters,
    burnRate: burnRateLPer1000Km(totalTopUpLiters, kmSinceLastService),
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
  const [currentOdometer, lastSample, lastService] = await Promise.all([
    loadLatestMileageLog(assetId),
    db.query.oilSamplesTable.findFirst({
      where: { assetId },
      orderBy: { drawnDate: "desc" },
    }),
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

  const [lastSampleOdometer, lastServiceOdometer, consumedOil] =
    await Promise.all([
      lastSample
        ? loadMileageOnOrBefore(assetId, lastSample.drawnDate)
        : Promise.resolve(null),
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
                gt(
                  oilConsumptionLogsTable.recordDate,
                  lastService.recordDate
                )
              )
            )
            .then((rows) => Number(rows[0]?.total ?? 0))
        : Promise.resolve(0),
    ])

  return toOilMetrics({
    currentOdometer,
    lastSampleOdometer,
    lastServiceOdometer,
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
        })
        .from(oilSamplesTable)
        .where(inArray(oilSamplesTable.assetId, assetIds))
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

  const mileagePairs = new Map<string, { assetId: number; onDate: string }>()
  for (const sample of lastSamples) {
    const onDate = toIsoDateString(sample.drawnDate)
    mileagePairs.set(`${sample.assetId}:${onDate}`, {
      assetId: sample.assetId,
      onDate,
    })
  }
  for (const service of lastServices) {
    const onDate = toIsoDateString(service.recordDate)
    mileagePairs.set(`${service.assetId}:${onDate}`, {
      assetId: service.assetId,
      onDate,
    })
  }

  const mileageByPair = await loadMileageOnOrBeforeDates([
    ...mileagePairs.values(),
  ])

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
        currentOdometer: currentByAsset.get(asset.id),
        lastSampleOdometer: lastSample
          ? mileageByPair.get(
              `${asset.id}:${toIsoDateString(lastSample.drawnDate)}`
            )
          : undefined,
        lastServiceOdometer: lastService
          ? mileageByPair.get(
              `${asset.id}:${toIsoDateString(lastService.recordDate)}`
            )
          : undefined,
        totalTopUpLiters: topUpByAsset.get(asset.id) ?? 0,
      }),
    }
  })
}
