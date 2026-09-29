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
import {
  CRITICAL_SERVICE_INTERVAL,
  type OilComplianceEvent,
  type OilComplianceStatus,
  type OilHealthRow,
  type OilMetrics,
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

// Dual-clock reset for *compliance status only*: a ≥35 L service or a
// logged sample keeps the unit compliant below 13 000 km, due soon
// through 15 000 km, and overdue after. Oil Running KM is independent
// of samples. KM Since Last Sample follows the last physical sample only
// when that sample was drawn after the latest ≥35 L fill; a later
// replenishment resets both kilometre clocks to the fill's nearest
// odometer.
const COMPLIANT_KM_LIMIT = 13_000
const OVERDUE_KM_LIMIT = CRITICAL_SERVICE_INTERVAL

// Broken-odometer failsafe: no new mileage log in this many days switches
// the unit from kilometre thresholds to a 75-day time clock (10-day warning).
const STALE_ODOMETER_DAYS = 30
const TIME_BASED_OVERDUE_DAYS = 75
const TIME_BASED_DUE_SOON_DAYS = 65
const MS_PER_DAY = 1000 * 60 * 60 * 24

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

function toStartOfLocalDay(value: Date | string): Date {
  if (typeof value === "string") {
    const [year, month, day] = value.split("-").map(Number)
    return new Date(year, month - 1, day)
  }

  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function daysBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY
}

function isStaleOdometer(
  latestOdometerDate: Date | string | null,
  today: Date
): boolean {
  if (latestOdometerDate == null) return true

  return (
    daysBetween(today, toStartOfLocalDay(latestOdometerDate)) >=
    STALE_ODOMETER_DAYS
  )
}

function calendarDay(value: Date) {
  return toIsoDateString(value)
}

function lastActionDateOf(
  latestService: { recordDate: Date } | null,
  latestSample: { drawnDate: Date } | null
): Date | null {
  if (!latestService && !latestSample) return null
  if (!latestService) return latestSample!.drawnDate
  if (!latestSample) return latestService.recordDate

  // Same calendar-day rule as the kilometre clock: a ≥35 L fill on or
  // after the sample day is the last action, even when the sample was
  // stamped later that afternoon.
  return calendarDay(latestSample.drawnDate) > calendarDay(latestService.recordDate)
    ? latestSample.drawnDate
    : latestService.recordDate
}

function timeBasedStatus(daysSinceAction: number): OilComplianceStatus {
  if (daysSinceAction >= TIME_BASED_OVERDUE_DAYS) return "overdue"
  if (daysSinceAction >= TIME_BASED_DUE_SOON_DAYS) return "due_soon"
  return "compliant"
}

function pickLastComplianceEvent(
  latestService: { recordDate: Date; odometer: number | null } | null,
  latestSample: { drawnDate: Date; odometer: number | null } | null
): { lastEvent: OilComplianceEvent; odometer: number | null } | null {
  // A drawn sample with no odometer still counts for the time clock, but
  // cannot reset kilometre compliance — fall back to the last service.
  const sampleWithOdometer =
    latestSample !== null && latestSample.odometer !== null
      ? latestSample
      : null

  if (!latestService && !sampleWithOdometer) return null

  if (!latestService) {
    return {
      lastEvent: "sample",
      odometer: sampleWithOdometer!.odometer,
    }
  }

  if (!sampleWithOdometer) {
    return {
      lastEvent: "service",
      odometer: latestService.odometer,
    }
  }

  // A ≥35 L replenishment on the same calendar day or later completely
  // overrides the Sample Drawn baseline for compliance and KM Since Last
  // Sample. Compare calendar days so a midnight service timestamp is not
  // beaten by a same-day afternoon draw. A sample drawn on a later day
  // still resets those kilometre clocks; Oil Running KM stays on the fill.
  if (
    calendarDay(sampleWithOdometer.drawnDate) >
    calendarDay(latestService.recordDate)
  ) {
    return {
      lastEvent: "sample",
      odometer: sampleWithOdometer.odometer,
    }
  }

  return {
    lastEvent: "service",
    odometer: latestService.odometer,
  }
}

function kmSinceLastSampleOf(
  currentOdometer: number | null,
  lastSample: { drawnDate: Date; odometer: number | null } | null,
  lastService: { recordDate: Date; odometer: number | null } | null
): number | null {
  if (currentOdometer === null) return null

  // Same timeline as compliance: a ≥35 L fill on or after the last
  // sample day is the testing-interval baseline. A later sample still
  // tracks distance since that draw.
  const lastEvent = pickLastComplianceEvent(lastService, lastSample)
  if (lastEvent === null || lastEvent.odometer === null) return null

  return currentOdometer - lastEvent.odometer
}

function unknownOilMetrics(
  currentOdometer: number | null,
  totalTopUpLiters: number,
  lastSample: { drawnDate: Date; odometer: number | null } | null
): OilMetrics {
  return {
    status: "unknown",
    currentKm: currentOdometer,
    oilRunningKm: null,
    kmSinceLastSample: kmSinceLastSampleOf(currentOdometer, lastSample, null),
    totalTopUpLiters,
    burnRate: null,
    overdueKilometers: 0,
    kmSinceCompliance: null,
    lastEvent: null,
    isTimeBased: false,
    daysSinceAction: null,
  }
}

function toOilMetrics(input: {
  currentOdometer: number | null
  latestOdometerDate: Date | string | null
  lastService: { recordDate: Date; odometer: number | null } | null
  lastSample: { drawnDate: Date; odometer: number | null } | null
  totalTopUpLiters: number
}): OilMetrics {
  const today = new Date()
  const isTimeBased = isStaleOdometer(input.latestOdometerDate, today)
  const lastActionDate = lastActionDateOf(input.lastService, input.lastSample)
  const daysSinceAction =
    lastActionDate === null
      ? null
      : daysBetween(today, lastActionDate)

  // No ≥35 L fill on file — keep the truck on the roster with a
  // structured unknown baseline instead of nulling the whole row.
  const metrics =
    input.lastService === null
      ? unknownOilMetrics(
          input.currentOdometer,
          input.totalTopUpLiters,
          input.lastSample
        )
      : distanceBasedOilMetrics({
          currentOdometer: input.currentOdometer,
          lastService: input.lastService,
          lastSample: input.lastSample,
          totalTopUpLiters: input.totalTopUpLiters,
        })

  if (isTimeBased) {
    return {
      ...metrics,
      // Time clock fully replaces kilometre thresholds, including the
      // unknown baseline when a sample or service date is on file.
      status:
        daysSinceAction === null ? "unknown" : timeBasedStatus(daysSinceAction),
      isTimeBased: true,
      daysSinceAction,
    }
  }

  return {
    ...metrics,
    isTimeBased: false,
    daysSinceAction,
  }
}

function distanceBasedOilMetrics(input: {
  currentOdometer: number | null
  lastService: { recordDate: Date; odometer: number | null }
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

  // Physical oil age only — last ≥35 L fill, never a sample draw.
  const oilRunningKm =
    input.currentOdometer !== null && input.lastService.odometer !== null
      ? input.currentOdometer - input.lastService.odometer
      : null

  const overdueKilometers =
    kmSinceCompliance === null
      ? 0
      : Math.max(0, kmSinceCompliance - CRITICAL_SERVICE_INTERVAL)

  return {
    status:
      kmSinceCompliance === null ? null : complianceStatus(kmSinceCompliance),
    kmSinceCompliance,
    overdueKilometers,
    totalTopUpLiters: input.totalTopUpLiters,
    burnRate: burnRateLPer1000Km(input.totalTopUpLiters, oilRunningKm),
    lastEvent: lastComplianceEvent?.lastEvent ?? null,
    currentKm: input.currentOdometer,
    oilRunningKm,
    // ≥35 L fill after the last draw (or no draw after the fill) uses the
    // fill's nearest odometer for both clocks. A later sample keeps a
    // separate testing-interval clock from that draw.
    kmSinceLastSample: kmSinceLastSampleOf(
      input.currentOdometer,
      input.lastSample,
      input.lastService
    ),
    isTimeBased: false,
    daysSinceAction: null,
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

// Nearest odometer on or before a ≥35 L replenishment. Workshop mileage
// is often missing on the exact fill day, so this must not `eq` the date
// — `lte` + latest row is the new service-interval baseline.
async function loadMileageOnOrBefore(assetId: number, at: Date) {
  const replenishmentDate = toIsoDateString(at)

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
        lte(mileageLogsTable.date, replenishmentDate)
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
          isNotNull(oilSamplesTable.drawnDate)
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
    db
      .select({ total: sum(oilConsumptionLogsTable.quantity) })
      .from(oilConsumptionLogsTable)
      .where(
        and(
          eq(oilConsumptionLogsTable.assetId, assetId),
          lt(oilConsumptionLogsTable.quantity, SERVICE_QUANTITY_LITERS),
          lastService
            ? gt(oilConsumptionLogsTable.recordDate, lastService.recordDate)
            : undefined
        )
      )
      .then((rows) => Number(rows[0]?.total ?? 0)),
  ])

  return toOilMetrics({
    currentOdometer: toOdometerKm(currentMileage?.odometer),
    latestOdometerDate: currentMileage?.date ?? null,
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

  // Same nearest-preceding rule as `loadMileageOnOrBefore`: not an exact
  // date match. Missing the fill-day log still yields the latest odometer
  // on or before that day, which overrides any Sample Drawn baseline.
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

  const [currentByAsset, lastSamples, lastServices, topUps, activeSamples] =
    await Promise.all([
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
            isNotNull(oilSamplesTable.drawnDate)
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
      db
        .selectDistinctOn([oilSamplesTable.assetId], {
          assetId: oilSamplesTable.assetId,
        })
        .from(oilSamplesTable)
        .where(
          and(
            inArray(oilSamplesTable.assetId, assetIds),
            inArray(oilSamplesTable.status, ["requested", "drawn", "sent"])
          )
        )
        .orderBy(oilSamplesTable.assetId, desc(oilSamplesTable.createdAt)),
    ])

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

  const activeSampleAssetIds = new Set(
    activeSamples.map((sample) => sample.assetId)
  )

  const topUpByAsset = new Map<number, number>()
  for (const topUp of topUps) {
    const lastService = lastServiceByAsset.get(topUp.assetId)
    // With a ≥35 L fill, only count top-ups after that service. With no
    // fill on file, sum every top-up so the unknown baseline still shows
    // how much oil has been issued.
    if (lastService && topUp.recordDate <= lastService.recordDate) continue

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
      hasActiveSample: activeSampleAssetIds.has(asset.id),
      ...toOilMetrics({
        currentOdometer: toOdometerKm(currentByAsset.get(asset.id)?.odometer),
        latestOdometerDate: currentByAsset.get(asset.id)?.date ?? null,
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

// Draw-time odometer and oil age for sampling-pipeline cards. `currentKm`
// is the sample's locked-in odometer (not the latest mileage log).
// `oilRunningKm` is that reading minus the last ≥35 L service on or
// before the draw, so later fills do not rewrite the card.
export async function getPipelineSampleMetrics(
  samples: {
    id: string
    assetId: number
    odometer: number | null
    drawnDate: Date | null
  }[]
): Promise<Map<string, { currentKm: number | null; oilRunningKm: number | null }>> {
  const metrics = new Map<
    string,
    { currentKm: number | null; oilRunningKm: number | null }
  >()

  for (const sample of samples) {
    metrics.set(sample.id, {
      currentKm: sample.odometer,
      oilRunningKm: null,
    })
  }

  const drawnSamples = samples.filter(
    (sample): sample is typeof sample & { odometer: number; drawnDate: Date } =>
      sample.odometer !== null && sample.drawnDate !== null
  )

  if (drawnSamples.length === 0) return metrics

  const assetIds = [...new Set(drawnSamples.map((sample) => sample.assetId))]

  const services = await db
    .select({
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
    .orderBy(desc(oilConsumptionLogsTable.recordDate))

  const servicesByAsset = new Map<number, { recordDate: Date }[]>()
  for (const service of services) {
    const list = servicesByAsset.get(service.assetId) ?? []
    list.push(service)
    servicesByAsset.set(service.assetId, list)
  }

  const serviceBySample = new Map<string, { assetId: number; onDate: string }>()
  const mileagePairs: { assetId: number; onDate: string }[] = []

  for (const sample of drawnSamples) {
    const lastService = (servicesByAsset.get(sample.assetId) ?? []).find(
      (service) => service.recordDate <= sample.drawnDate
    )
    if (!lastService) continue

    const pair = {
      assetId: sample.assetId,
      onDate: toIsoDateString(lastService.recordDate),
    }
    serviceBySample.set(sample.id, pair)
    mileagePairs.push(pair)
  }

  const mileageByPair = await loadMileageOnOrBeforeDates(mileagePairs)

  for (const sample of drawnSamples) {
    const pair = serviceBySample.get(sample.id)
    if (!pair) continue

    const serviceOdometer = toOdometerKm(
      mileageByPair.get(`${pair.assetId}:${pair.onDate}`)?.odometer
    )
    if (serviceOdometer === null) continue

    metrics.set(sample.id, {
      currentKm: sample.odometer,
      oilRunningKm: sample.odometer - serviceOdometer,
    })
  }

  return metrics
}
