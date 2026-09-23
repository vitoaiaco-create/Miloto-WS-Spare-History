import "server-only"

import {
  and,
  countDistinct,
  eq,
  gte,
  ilike,
  lt,
  max,
  min,
  not,
  or,
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

const HIGH_YIELD_KM = 6_000
const TARGET_YIELD_KM = 4_000
const SUSPENSION_DEDUCTION_PER_JOB_CARD = 5

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

function monthWindow(year: number, month: number) {
  const activeMonth = `${year}-${String(month).padStart(2, "0")}-01`
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`

  return { activeMonth, nextMonthStart }
}

// Same motive/towed split as workshop analytics: stored trailers are
// `assetType = "Trailer"`, and older identities can still carry "TRAILER"
// in the fleet name.
function motiveUnitFilter() {
  const trailer = or(
    ilike(assetsTable.assetName, "%TRAILER%"),
    eq(assetsTable.assetType, "Trailer")
  )

  if (!trailer) {
    throw new Error("Trailer identity filter is required")
  }

  return not(trailer)
}

function isTrailerAsset(asset: AssetInfo) {
  return (
    asset.assetType === "Trailer" ||
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

function odometerDelta(
  minOdometer: string | null,
  maxOdometer: string | null
) {
  const low = toFiniteNumber(minOdometer)
  const high = toFiniteNumber(maxOdometer)
  return Math.max(0, high - low)
}

// < 4 000 km scores 0. The +10 band starts at the next kilometre (4 001)
// and runs through 6 000. Anything above 6 000 scores +20.
function productivityPointsForKm(km: number) {
  if (km > HIGH_YIELD_KM) return 20
  if (km > TARGET_YIELD_KM) return 10
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

  const { activeMonth, nextMonthStart } = monthWindow(year, month)
  const loggedInMonth = and(
    sql`(${tireIncidentsTable.incidentDate})::date >= ${activeMonth}::date`,
    sql`(${tireIncidentsTable.incidentDate})::date < ${nextMonthStart}::date`
  )

  const [distanceRows, pairings, tireByAssetRows, tireByDriverRows, suspensionRows] =
    await Promise.all([
      db
        .select({
          assetId: mileageLogsTable.assetId,
          assetName: assetsTable.assetName,
          assetType: assetsTable.assetType,
          minOdometer: min(mileageLogsTable.odometer),
          maxOdometer: max(mileageLogsTable.odometer),
        })
        .from(mileageLogsTable)
        .innerJoin(
          assetsTable,
          eq(mileageLogsTable.assetId, assetsTable.id)
        )
        .where(
          and(
            gte(mileageLogsTable.date, activeMonth),
            lt(mileageLogsTable.date, nextMonthStart),
            motiveUnitFilter()
          )
        )
        .groupBy(
          mileageLogsTable.assetId,
          assetsTable.assetName,
          assetsTable.assetType
        ),
      db.query.monthlyPairingsTable.findMany({
        where: { activeMonth },
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
          points: sum(tireIncidentsTable.penaltyPoints),
        })
        .from(tireIncidentsTable)
        .innerJoin(
          assetsTable,
          eq(tireIncidentsTable.assetId, assetsTable.id)
        )
        .where(loggedInMonth)
        .groupBy(
          tireIncidentsTable.assetId,
          assetsTable.assetName,
          assetsTable.assetType
        ),
      db
        .select({
          driverId: tireIncidentsTable.driverId,
          driverName: driversTable.name,
          points: sum(tireIncidentsTable.penaltyPoints),
        })
        .from(tireIncidentsTable)
        .innerJoin(
          driversTable,
          eq(tireIncidentsTable.driverId, driversTable.id)
        )
        .where(loggedInMonth)
        .groupBy(tireIncidentsTable.driverId, driversTable.name),
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
            gte(mechanicalSparesTable.fitmentDate, activeMonth),
            lt(mechanicalSparesTable.fitmentDate, nextMonthStart),
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
  const truckMovement = new Map<number, Movement>()

  for (const row of distanceRows) {
    const asset = {
      id: row.assetId,
      name: row.assetName,
      assetType: row.assetType,
    }
    assets.set(asset.id, asset)

    const km = odometerDelta(row.minOdometer, row.maxOdometer)
    truckMovement.set(asset.id, {
      km,
      productivity: productivityPointsForKm(km),
    })
  }

  const trailerMovement = new Map<number, Movement>()
  const driverMovement = new Map<number, Movement>()
  const driverNames = new Map<number, string>()
  const driversByAsset = new Map<number, Set<number>>()
  const trucksSeenByDriver = new Map<number, Set<number>>()
  const pairedTruckIds = new Set<number>()
  const pairedTrailerIds = new Set<number>()

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

    const movement = truckMovement.get(truck.id) ?? {
      km: 0,
      productivity: 0,
    }
    if (!truckMovement.has(truck.id)) {
      truckMovement.set(truck.id, movement)
    }

    // A trailer has one pairing per month, so it takes that truck's
    // distance and productivity in full.
    trailerMovement.set(trailer.id, {
      km: movement.km,
      productivity: movement.productivity,
    })

    // Two trailers on the same truck must not credit the driver twice.
    const seenTrucks = trucksSeenByDriver.get(driver.id) ?? new Set<number>()
    if (!seenTrucks.has(truck.id)) {
      seenTrucks.add(truck.id)
      trucksSeenByDriver.set(driver.id, seenTrucks)

      const current = driverMovement.get(driver.id) ?? {
        km: 0,
        productivity: 0,
      }
      driverMovement.set(driver.id, {
        km: current.km + movement.km,
        productivity: current.productivity + movement.productivity,
      })
    }
  }

  const tireByAsset = new Map<number, number>()
  for (const row of tireByAssetRows) {
    rememberAsset({
      id: row.assetId,
      name: row.assetName,
      assetType: row.assetType,
    })
    tireByAsset.set(row.assetId, asDeduction(toFiniteNumber(row.points)))
  }

  const tireByDriver = new Map<number, number>()
  for (const row of tireByDriverRows) {
    driverNames.set(row.driverId, row.driverName)
    tireByDriver.set(row.driverId, asDeduction(toFiniteNumber(row.points)))
  }

  const suspensionByAsset = new Map<number, number>()
  const suspensionByDriver = new Map<number, number>()

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

    for (const driverId of driversByAsset.get(row.assetId) ?? []) {
      suspensionByDriver.set(
        driverId,
        (suspensionByDriver.get(driverId) ?? 0) + deduction
      )
    }
  }

  const truckIds = new Set<number>(pairedTruckIds)
  const trailerIds = new Set<number>(pairedTrailerIds)

  for (const assetId of truckMovement.keys()) {
    if (!pairedTrailerIds.has(assetId)) truckIds.add(assetId)
  }

  for (const assetId of assets.keys()) {
    const hasPenalty =
      tireByAsset.has(assetId) || suspensionByAsset.has(assetId)
    if (!hasPenalty || truckIds.has(assetId) || trailerIds.has(assetId)) {
      continue
    }

    const asset = assets.get(assetId)
    if (asset && isTrailerAsset(asset)) trailerIds.add(assetId)
    else truckIds.add(assetId)
  }

  const scores: MonthlyYieldScore[] = []

  for (const assetId of truckIds) {
    const asset = assets.get(assetId)
    if (!asset) continue

    const movement = truckMovement.get(assetId) ?? {
      km: 0,
      productivity: 0,
    }
    scores.push(
      finalize({
        entityType: "Truck",
        entityId: assetId,
        name: asset.name,
        totalMileageKm: movement.km,
        productivityPoints: movement.productivity,
        tirePenaltyPoints: tireByAsset.get(assetId) ?? 0,
        suspensionPenaltyPoints: suspensionByAsset.get(assetId) ?? 0,
      })
    )
  }

  for (const assetId of trailerIds) {
    const asset = assets.get(assetId)
    if (!asset) continue

    const movement = trailerMovement.get(assetId) ?? {
      km: 0,
      productivity: 0,
    }
    scores.push(
      finalize({
        entityType: "Trailer",
        entityId: assetId,
        name: asset.name,
        totalMileageKm: movement.km,
        productivityPoints: movement.productivity,
        tirePenaltyPoints: tireByAsset.get(assetId) ?? 0,
        suspensionPenaltyPoints: suspensionByAsset.get(assetId) ?? 0,
      })
    )
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
