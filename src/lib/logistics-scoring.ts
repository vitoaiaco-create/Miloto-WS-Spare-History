import "server-only"

import {
  and,
  asc,
  countDistinct,
  eq,
  gte,
  lte,
  sql,
  sum,
} from "drizzle-orm"

import { db } from "@/db"
import {
  assetsTable,
  driversTable,
  mechanicalSparesTable,
  mileageLogsTable,
  tireIncidentsTable,
} from "@/db/schema"

export type LogisticsEntityType = "Truck" | "Trailer" | "Driver"

// Class A is high yield with a small penalty. Class B is the 4 001–6 000 km
// baseline (or a high-yield unit pulled back to that score). Class C is
// still non-negative but below the baseline. Class D is a net liability.
export type MatrixClass = "Class A" | "Class B" | "Class C" | "Class D"

export type MonthlyYieldScore = {
  entityType: LogisticsEntityType
  entityId: number
  name: string
  totalMileageKm: number
  productivityPoints: number
  tirePenaltyPoints: number
  suspensionPenaltyPoints: number
  netScore: number
  matrixClass: MatrixClass
}

export type YTDMonthYield = {
  month: number
  mileage: number
  prodPts: number
  tyrePts: number
  suspPts: number
  netScore: number
}

export type YTDYieldScore = {
  id: number
  type: "Truck" | "Trailer"
  displayName: string
  ytdNetScore: number
  currentClass: MatrixClass
  monthlyData: YTDMonthYield[]
}

const HIGH_YIELD_KM = 6_000
const TARGET_YIELD_KM = 4_000
const SUSPENSION_DEDUCTION_PER_JOB_CARD = 5
// Physically plausible ceiling for one daily hop (~800 km round trip).
const MAX_VALID_DAILY_KM = 800

type AssetInfo = {
  id: number
  name: string
  assetType: string
}

type Movement = {
  km: number
  productivity: number
}

function assertCalendarMonth(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Year must be an integer between 2000 and 2100")
  }

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Month must be an integer between 1 and 12")
  }
}

function monthBounds(year: number, month: number) {
  const startOfMonth = `${year}-${String(month).padStart(2, "0")}-01`
  // Day 0 of the following month is the last calendar day of `month`.
  const endOfMonth = new Date(Date.UTC(year, month, 0))
    .toISOString()
    .slice(0, 10)

  return { startOfMonth, endOfMonth }
}

function isTrailerAsset(asset: AssetInfo) {
  return (
    asset.assetType.trim().toLowerCase() === "trailer" ||
    asset.name.toUpperCase().includes("TRAILER")
  )
}

function toFiniteNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundKm(value: number) {
  return Math.round(value * 100) / 100
}

// Sum consecutive odometer hops, dropping backward typing and ghost jumps.
function sumValidDailyDeltas(odometers: Array<string | number>) {
  let totalValidDistance = 0

  for (let i = 1; i < odometers.length; i++) {
    const delta = toFiniteNumber(odometers[i]) - toFiniteNumber(odometers[i - 1])
    if (delta > 0 && delta <= MAX_VALID_DAILY_KM) {
      totalValidDistance += delta
    }
  }

  return totalValidDistance
}

// < 4 000 km scores 0. 4 001–6 000 km scores +10. Above 6 000 km scores +20.
function productivityPointsForKm(km: number) {
  if (km > HIGH_YIELD_KM) return 20
  if (km >= TARGET_YIELD_KM + 1) return 10
  return 0
}

// Logged tire points are a penalty magnitude. Already-negative values are
// left as deductions so a row stored as -5 is not flipped twice.
function asDeduction(points: number) {
  if (points === 0) return 0
  return points > 0 ? -points : points
}

function matrixClassFor(
  netScore: number,
  productivityPoints: number
): MatrixClass {
  if (netScore < 0) return "Class D"
  if (productivityPoints >= 20 && netScore >= 15) return "Class A"
  if (netScore >= 10) return "Class B"
  return "Class C"
}

function finalize(draft: {
  entityType: LogisticsEntityType
  entityId: number
  name: string
  totalMileageKm: number
  productivityPoints: number
  tirePenaltyPoints: number
  suspensionPenaltyPoints: number
}): MonthlyYieldScore {
  const netScore =
    draft.productivityPoints +
    draft.tirePenaltyPoints +
    draft.suspensionPenaltyPoints

  return {
    ...draft,
    totalMileageKm: roundKm(draft.totalMileageKm),
    netScore,
    matrixClass: matrixClassFor(netScore, draft.productivityPoints),
  }
}

export async function calculateMonthlyYield(
  year: number,
  month: number
): Promise<MonthlyYieldScore[]> {
  assertCalendarMonth(year, month)

  const { startOfMonth, endOfMonth } = monthBounds(year, month)
  const loggedInMonth = and(
    sql`(${tireIncidentsTable.incidentDate})::date >= ${startOfMonth}::date`,
    sql`(${tireIncidentsTable.incidentDate})::date <= ${endOfMonth}::date`
  )

  const [mileageLogs, pairings, tireRows, suspensionRows] = await Promise.all([
    db
      .select({
        assetId: mileageLogsTable.assetId,
        assetName: assetsTable.assetName,
        assetType: assetsTable.assetType,
        date: mileageLogsTable.date,
        odometer: mileageLogsTable.odometer,
      })
      .from(mileageLogsTable)
      .innerJoin(assetsTable, eq(mileageLogsTable.assetId, assetsTable.id))
      .where(
        and(
          gte(mileageLogsTable.date, startOfMonth),
          lte(mileageLogsTable.date, endOfMonth)
        )
      )
      .orderBy(asc(mileageLogsTable.assetId), asc(mileageLogsTable.date)),
    db.query.monthlyPairingsTable.findMany({
      where: {
        activeMonth: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      with: {
        truck: true,
        trailer: true,
        driver: true,
      },
    }),
    db
      .select({
        assetId: tireIncidentsTable.assetId,
        assetName: assetsTable.assetName,
        assetType: assetsTable.assetType,
        driverId: tireIncidentsTable.driverId,
        driverName: driversTable.name,
        points: sum(tireIncidentsTable.penaltyPoints),
      })
      .from(tireIncidentsTable)
      .innerJoin(assetsTable, eq(tireIncidentsTable.assetId, assetsTable.id))
      .innerJoin(
        driversTable,
        eq(tireIncidentsTable.driverId, driversTable.id)
      )
      .where(loggedInMonth)
      .groupBy(
        tireIncidentsTable.assetId,
        assetsTable.assetName,
        assetsTable.assetType,
        tireIncidentsTable.driverId,
        driversTable.name
      ),
    db
      .select({
        assetId: mechanicalSparesTable.assetId,
        assetName: assetsTable.assetName,
        assetType: assetsTable.assetType,
        jobCards: countDistinct(mechanicalSparesTable.jobCardNo),
      })
      .from(mechanicalSparesTable)
      .innerJoin(
        assetsTable,
        eq(mechanicalSparesTable.assetId, assetsTable.id)
      )
      .where(
        and(
          gte(mechanicalSparesTable.fitmentDate, startOfMonth),
          lte(mechanicalSparesTable.fitmentDate, endOfMonth),
          // Ingestion title-cases Sub Equipment ("Suspension"); match the
          // category either way.
          sql`upper(${mechanicalSparesTable.tier1}) = 'SUSPENSION'`
        )
      )
      .groupBy(
        mechanicalSparesTable.assetId,
        assetsTable.assetName,
        assetsTable.assetType
      ),
  ])

  const assets = new Map<number, AssetInfo>()
  const monthlyKm = new Map<number, number>()
  const odometersByAsset = new Map<number, Array<string | number>>()

  for (const row of mileageLogs) {
    assets.set(row.assetId, {
      id: row.assetId,
      name: row.assetName,
      assetType: row.assetType,
    })
    const readings = odometersByAsset.get(row.assetId) ?? []
    readings.push(row.odometer)
    odometersByAsset.set(row.assetId, readings)
  }

  for (const [assetId, odometers] of odometersByAsset) {
    monthlyKm.set(assetId, sumValidDailyDeltas(odometers))
  }

  const driverNames = new Map<number, string>()
  const driversByAsset = new Map<number, Set<number>>()
  const pairedTruckIds = new Set<number>()
  const pairedTrailerIds = new Set<number>()
  const pairingsByTruck = new Map<number, typeof pairings>()

  function rememberAsset(asset: AssetInfo) {
    assets.set(asset.id, asset)
  }

  function rememberDriverOnAsset(assetId: number, driverId: number) {
    const drivers = driversByAsset.get(assetId) ?? new Set<number>()
    drivers.add(driverId)
    driversByAsset.set(assetId, drivers)
  }

  for (const pairing of pairings) {
    const truck = pairing.truck
    const trailer = pairing.trailer
    const driver = pairing.driver

    rememberAsset({
      id: truck.id,
      name: truck.assetName,
      assetType: truck.assetType,
    })
    rememberAsset({
      id: trailer.id,
      name: trailer.assetName,
      assetType: trailer.assetType,
    })
    driverNames.set(driver.id, driver.name)
    pairedTruckIds.add(truck.id)
    pairedTrailerIds.add(trailer.id)
    rememberDriverOnAsset(truck.id, driver.id)
    rememberDriverOnAsset(trailer.id, driver.id)

    const links = pairingsByTruck.get(truck.id) ?? []
    links.push(pairing)
    pairingsByTruck.set(truck.id, links)
  }

  function usesOwnOdometer(assetId: number, asset: AssetInfo) {
    if (pairedTruckIds.has(assetId)) return true
    if (pairedTrailerIds.has(assetId)) return false
    return !isTrailerAsset(asset)
  }

  const truckMovement = new Map<number, Movement>()

  for (const [assetId, km] of monthlyKm) {
    const asset = assets.get(assetId)
    if (!asset || !usesOwnOdometer(assetId, asset)) continue

    truckMovement.set(assetId, {
      km,
      productivity: productivityPointsForKm(km),
    })
  }

  for (const truckId of pairedTruckIds) {
    if (truckMovement.has(truckId)) continue

    const km = monthlyKm.get(truckId) ?? 0
    truckMovement.set(truckId, {
      km,
      productivity: productivityPointsForKm(km),
    })
  }

  const trailerMovement = new Map<number, Movement>()
  const driverMovement = new Map<number, Movement>()
  const trucksSeenByDriver = new Map<number, Set<number>>()

  for (const [truckId, movement] of truckMovement) {
    for (const pairing of pairingsByTruck.get(truckId) ?? []) {
      const trailerId = pairing.trailer.id
      const driverId = pairing.driver.id

      // One trailer has one pairing per month, so it takes that truck's
      // distance and productivity in full.
      trailerMovement.set(trailerId, {
        km: movement.km,
        productivity: movement.productivity,
      })

      // Two trailers on the same truck must not credit the driver twice.
      // A second truck adds its own mileage and its own productivity.
      const seenTrucks = trucksSeenByDriver.get(driverId) ?? new Set<number>()
      if (seenTrucks.has(truckId)) continue

      seenTrucks.add(truckId)
      trucksSeenByDriver.set(driverId, seenTrucks)

      const current = driverMovement.get(driverId) ?? {
        km: 0,
        productivity: 0,
      }
      driverMovement.set(driverId, {
        km: current.km + movement.km,
        productivity: current.productivity + movement.productivity,
      })
    }
  }

  const tireByAsset = new Map<number, number>()
  const tirePortionByAssetDriver = new Map<number, Map<number, number>>()

  for (const row of tireRows) {
    rememberAsset({
      id: row.assetId,
      name: row.assetName,
      assetType: row.assetType,
    })
    driverNames.set(row.driverId, row.driverName)

    const deduction = asDeduction(toFiniteNumber(row.points))
    tireByAsset.set(row.assetId, (tireByAsset.get(row.assetId) ?? 0) + deduction)

    const portions =
      tirePortionByAssetDriver.get(row.assetId) ?? new Map<number, number>()
    portions.set(row.driverId, (portions.get(row.driverId) ?? 0) + deduction)
    tirePortionByAssetDriver.set(row.assetId, portions)
  }

  const tireByDriver = new Map<number, number>()
  const suspensionByAsset = new Map<number, number>()
  const suspensionByDriver = new Map<number, number>()

  function chargeDrivers(
    assetId: number,
    deduction: number,
    bucket: Map<number, number>,
    fallback?: Map<number, number>
  ) {
    const paired = driversByAsset.get(assetId)
    if (paired && paired.size > 0) {
      for (const driverId of paired) {
        bucket.set(driverId, (bucket.get(driverId) ?? 0) + deduction)
      }
      return
    }

    if (!fallback) return

    for (const [driverId, portion] of fallback) {
      bucket.set(driverId, (bucket.get(driverId) ?? 0) + portion)
    }
  }

  for (const [assetId, deduction] of tireByAsset) {
    chargeDrivers(
      assetId,
      deduction,
      tireByDriver,
      tirePortionByAssetDriver.get(assetId)
    )
  }

  for (const row of suspensionRows) {
    const jobCards = toFiniteNumber(row.jobCards)
    if (jobCards <= 0) continue

    rememberAsset({
      id: row.assetId,
      name: row.assetName,
      assetType: row.assetType,
    })

    const deduction = -SUSPENSION_DEDUCTION_PER_JOB_CARD * jobCards
    suspensionByAsset.set(row.assetId, deduction)
    chargeDrivers(row.assetId, deduction, suspensionByDriver)
  }

  function entityTypeForAsset(
    assetId: number,
    asset: AssetInfo
  ): "Truck" | "Trailer" {
    if (pairedTrailerIds.has(assetId) && !pairedTruckIds.has(assetId)) {
      return "Trailer"
    }
    if (pairedTruckIds.has(assetId)) return "Truck"
    return isTrailerAsset(asset) ? "Trailer" : "Truck"
  }

  const emittedAssets = new Set<number>()
  const scores: MonthlyYieldScore[] = []

  function pushAsset(
    entityType: "Truck" | "Trailer",
    assetId: number,
    movement: Movement
  ) {
    if (emittedAssets.has(assetId)) return

    const asset = assets.get(assetId)
    if (!asset) return

    emittedAssets.add(assetId)
    scores.push(
      finalize({
        entityType,
        entityId: assetId,
        name: asset.name,
        totalMileageKm: movement.km,
        productivityPoints: movement.productivity,
        tirePenaltyPoints: tireByAsset.get(assetId) ?? 0,
        suspensionPenaltyPoints: suspensionByAsset.get(assetId) ?? 0,
      })
    )
  }

  for (const [assetId, movement] of truckMovement) {
    const asset = assets.get(assetId)
    if (!asset || entityTypeForAsset(assetId, asset) !== "Truck") continue
    pushAsset("Truck", assetId, movement)
  }

  for (const [assetId, movement] of trailerMovement) {
    pushAsset("Trailer", assetId, movement)
  }

  for (const [assetId, asset] of assets) {
    const hasPenalty =
      tireByAsset.has(assetId) || suspensionByAsset.has(assetId)
    if (!hasPenalty) continue

    const entityType = entityTypeForAsset(assetId, asset)
    const movement =
      entityType === "Trailer"
        ? (trailerMovement.get(assetId) ?? { km: 0, productivity: 0 })
        : (truckMovement.get(assetId) ?? { km: 0, productivity: 0 })
    pushAsset(entityType, assetId, movement)
  }

  const driverIds = new Set<number>([
    ...driverMovement.keys(),
    ...tireByDriver.keys(),
    ...suspensionByDriver.keys(),
  ])

  for (const driverId of driverIds) {
    const movement = driverMovement.get(driverId) ?? {
      km: 0,
      productivity: 0,
    }
    scores.push(
      finalize({
        entityType: "Driver",
        entityId: driverId,
        name: driverNames.get(driverId) ?? `Driver ${driverId}`,
        totalMileageKm: movement.km,
        productivityPoints: movement.productivity,
        tirePenaltyPoints: tireByDriver.get(driverId) ?? 0,
        suspensionPenaltyPoints: suspensionByDriver.get(driverId) ?? 0,
      })
    )
  }

  const kindOrder: Record<LogisticsEntityType, number> = {
    Truck: 0,
    Trailer: 1,
    Driver: 2,
  }

  scores.sort(
    (a, b) =>
      kindOrder[a.entityType] - kindOrder[b.entityType] ||
      a.name.localeCompare(b.name) ||
      a.entityId - b.entityId
  )

  return scores
}

type AssetYtdDraft = {
  id: number
  type: "Truck" | "Trailer"
  name: string
  ytdNetScore: number
  ytdProdPts: number
  monthlyData: YTDMonthYield[]
}

function displayNameFor(assetName: string, driverName: string | undefined) {
  return driverName ? `${assetName} - ${driverName}` : assetName
}

export async function calculateYTDYield(
  year: number,
  endMonth: number
): Promise<YTDYieldScore[]> {
  assertCalendarMonth(year, endMonth)

  const { startOfMonth: ytdStart } = monthBounds(year, 1)
  const { endOfMonth: ytdEnd } = monthBounds(year, endMonth)

  const [pairings, ...monthlyResults] = await Promise.all([
    db.query.monthlyPairingsTable.findMany({
      where: {
        activeMonth: {
          gte: ytdStart,
          lte: ytdEnd,
        },
      },
      with: {
        truck: true,
        trailer: true,
        driver: true,
      },
    }),
    ...Array.from({ length: endMonth }, (_, index) =>
      calculateMonthlyYield(year, index + 1)
    ),
  ])

  // Later pairings overwrite earlier ones so each asset keeps the driver
  // from its most recent month in the YTD window.
  const latestDriverByAsset = new Map<number, string>()
  const chronologicalPairings = [...pairings].sort((a, b) => {
    const byMonth = a.activeMonth.localeCompare(b.activeMonth)
    return byMonth !== 0 ? byMonth : a.id - b.id
  })

  for (const pairing of chronologicalPairings) {
    latestDriverByAsset.set(pairing.truck.id, pairing.driver.name)
    latestDriverByAsset.set(pairing.trailer.id, pairing.driver.name)
  }

  const byAsset = new Map<number, AssetYtdDraft>()

  for (let month = 1; month <= endMonth; month++) {
    const scores = monthlyResults[month - 1]

    for (const score of scores) {
      if (score.entityType === "Driver") continue

      const monthRow: YTDMonthYield = {
        month,
        mileage: score.totalMileageKm,
        prodPts: score.productivityPoints,
        tyrePts: score.tirePenaltyPoints,
        suspPts: score.suspensionPenaltyPoints,
        netScore: score.netScore,
      }

      const existing = byAsset.get(score.entityId)
      if (!existing) {
        byAsset.set(score.entityId, {
          id: score.entityId,
          type: score.entityType,
          name: score.name,
          ytdNetScore: score.netScore,
          ytdProdPts: score.productivityPoints,
          monthlyData: [monthRow],
        })
        continue
      }

      existing.type = score.entityType
      existing.name = score.name
      existing.ytdNetScore += score.netScore
      existing.ytdProdPts += score.productivityPoints
      existing.monthlyData.push(monthRow)
    }
  }

  const kindOrder: Record<"Truck" | "Trailer", number> = {
    Truck: 0,
    Trailer: 1,
  }

  return [...byAsset.values()]
    .map((draft) => ({
      id: draft.id,
      type: draft.type,
      displayName: displayNameFor(
        draft.name,
        latestDriverByAsset.get(draft.id)
      ),
      ytdNetScore: draft.ytdNetScore,
      currentClass: matrixClassFor(draft.ytdNetScore, draft.ytdProdPts),
      monthlyData: draft.monthlyData,
    }))
    .sort(
      (a, b) =>
        kindOrder[a.type] - kindOrder[b.type] ||
        a.displayName.localeCompare(b.displayName) ||
        a.id - b.id
    )
}
