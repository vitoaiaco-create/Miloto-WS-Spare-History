import "server-only"

import {
  and,
  asc,
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
  tirePenaltiesTable,
} from "@/db/schema"

export type LogisticsEntityType = "Truck" | "Trailer" | "Driver"

// Class is the average monthly score: A ≥ 20, B ≥ 10, C ≥ 0, D < 0.
export type MatrixClass = "Class A" | "Class B" | "Class C" | "Class D"

export type MonthlyYieldScore = {
  entityType: LogisticsEntityType
  entityId: number
  name: string
  totalMileageKm: number
  productivityPoints: number
  safeDrivingBonus: number
  tirePenaltyPoints: number
  suspensionPenaltyPoints: number
  netScore: number
  matrixClass: MatrixClass
}

export type PenaltyDetail = {
  date: string
  reason: string
  amount: number
  visualId?: string
}

export type MotiveUnitMonthYield = {
  month: number
  driverName: string
  trailerName: string
  distance: number
  prodPts: number
  safeDrivingBonus: number
  truckPen: number
  trailerPen: number
  truckPenaltyDetails: PenaltyDetail[]
  trailerPenaltyDetails: PenaltyDetail[]
  netScore: number
}

export type MotiveUnitYieldScore = {
  id: number
  displayName: string
  ytdNetScore: number
  averageMonthlyScore: number
  currentClass: MatrixClass
  monthlyData: MotiveUnitMonthYield[]
}

export type OperatorMonthYield = {
  month: number
  trucksOperated: string
  trailersPulled: string
  distance: number
  prodPts: number
  safeDrivingBonus: number
  penalties: number
  penaltyDetails: PenaltyDetail[]
  netScore: number
}

export type OperatorYieldScore = {
  id: number
  displayName: string
  ytdNetScore: number
  averageMonthlyScore: number
  currentClass: MatrixClass
  monthlyData: OperatorMonthYield[]
}

const HIGH_YIELD_KM = 7_000
const TARGET_YIELD_KM = 4_000
const SAFE_DRIVING_BONUS = 20
// Physically plausible ceiling for one daily hop (~800 km round trip).
const MAX_VALID_DAILY_KM = 800

type SuspensionPenaltyBand = {
  readonly points: 20 | 10 | 5
  readonly patterns: readonly string[]
}

// Most severe band first so an overlapping description takes the heavier hit.
const TRUCK_SUSPENSION_MATRIX: readonly SuspensionPenaltyBand[] = [
  {
    points: 20,
    patterns: ["FRONT LEAF SPRING D13A", "SECOND-HAND FRONT LEAF SPRI"],
  },
  {
    points: 10,
    patterns: [
      "V-STAY",
      "DRAG LINK",
      "KING PIN",
      "ENGINE MOUNT",
      "RUBBER MOUNTING",
      "FRONT AXLE SHOCK",
      "REAR DIFF SHOCK",
      "SHOCK ABSORBER FOR VOLVO",
      "SHOCK ABSORBER CB0204",
      "SHOCK ABSORBER FH REAR",
      "SHOCK ABSORBER CB0040",
      "SHOCK ABSORBER 312706",
      "TIE ROD",
      "TRACK ROD",
      "HOLLOW SPRING",
      "STABILIZER",
      "REPAIR KIT, BOGIE",
    ],
  },
  {
    points: 5,
    patterns: ["CABIN", "SMALL FRONT CABIN SHOCK"],
  },
]

const TRAILER_SUSPENSION_MATRIX: readonly SuspensionPenaltyBand[] = [
  {
    points: 20,
    patterns: ["8 BLADES HEAVY DUTY", "LEAF SPRING HENRED"],
  },
  {
    points: 10,
    patterns: [
      "BOTTOM PLATE",
      "WEAR PLATE",
      "FIXED SOLID ARM",
      "HANGER",
      "ROCKER BOX",
      "ROCKER HANGER",
      "ADJUSTABLE TORQ",
      "TOP SADDLE",
    ],
  },
  {
    points: 5,
    patterns: [
      "CENTRE BOLT",
      "RADIUS ROD",
      "RADIUS PIN",
      "ROCKER PIN",
      "U-BOLT",
    ],
  },
]

function matchSuspensionPenalty(
  materialName: string,
  matrix: readonly SuspensionPenaltyBand[]
): number {
  const haystack = materialName.toUpperCase()

  for (const band of matrix) {
    if (band.patterns.some((pattern) => haystack.includes(pattern))) {
      return -band.points
    }
  }

  return 0
}

function truckSuspensionPenaltyPoints(materialName: string): number {
  return matchSuspensionPenalty(materialName, TRUCK_SUSPENSION_MATRIX)
}

function trailerSuspensionPenaltyPoints(materialName: string): number {
  return matchSuspensionPenalty(materialName, TRAILER_SUSPENSION_MATRIX)
}

function suspensionPenaltyPointsForKind(
  materialName: string,
  kind: "Truck" | "Trailer"
): number {
  return kind === "Trailer"
    ? trailerSuspensionPenaltyPoints(materialName)
    : truckSuspensionPenaltyPoints(materialName)
}

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

// Fleet motive units are stored as "Prime Mover"; treat an explicit "Truck"
// type the same way so both match type = Truck.
function isTruckAsset(asset: AssetInfo) {
  const type = asset.assetType.trim().toLowerCase()
  return type === "truck" || type === "prime mover"
}

function toIsoDate(value: string | Date) {
  const iso = typeof value === "string" ? value : value.toISOString()
  return iso.slice(0, 10)
}

function calendarMonthFromDate(value: string | Date) {
  return Number(toIsoDate(value).slice(5, 7))
}

function sortPenaltyDetails(details: PenaltyDetail[]) {
  return [...details].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.reason.localeCompare(b.reason) ||
      (a.visualId ?? "").localeCompare(b.visualId ?? "")
  )
}

function assetMonthKey(assetId: number, month: number) {
  return `${assetId}:${month}`
}

function uniqueById<T extends { id: number }>(items: T[]) {
  const seen = new Set<number>()
  const unique: T[] = []

  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    unique.push(item)
  }

  return unique
}

function uniqueJoinedNames(names: string[]) {
  return [...new Set(names.filter((name) => name.trim().length > 0))]
    .sort((a, b) => a.localeCompare(b))
    .join(", ")
}

function toFiniteNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundKm(value: number) {
  return Math.round(value * 100) / 100
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10
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

// > 7 000 km scores +10. > 4 000 km scores +5. 4 000 km and below scores 0.
function productivityPointsForKm(km: number) {
  if (km > HIGH_YIELD_KM) return 10
  if (km > TARGET_YIELD_KM) return 5
  return 0
}

// Zero-penalty months earn the stipend. Any deduction (even −5) zeros it.
function safeDrivingBonusFor(penalties: number) {
  return penalties === 0 ? SAFE_DRIVING_BONUS : 0
}

// Logged tire points are a penalty magnitude. Already-negative values are
// left as deductions so a row stored as -5 is not flipped twice.
function asDeduction(points: number) {
  if (points === 0) return 0
  return points > 0 ? -points : points
}

// Single-month net score. A clean month with the stipend scores 20.
function monthlyMatrixClassFor(netScore: number): MatrixClass {
  if (netScore >= 20) return "Class A"
  if (netScore >= 10) return "Class B"
  if (netScore >= 0) return "Class C"
  return "Class D"
}

// Year-to-date class from the average across active months. Class A also
// requires tenure, so a high average with fewer than 7 active months is B.
function matrixClassFor(
  averageMonthlyScore: number,
  activeMonths: number
): MatrixClass {
  if (averageMonthlyScore >= 12 && activeMonths >= 7) return "Class A"
  if (averageMonthlyScore >= 8) return "Class B"
  if (averageMonthlyScore >= 0) return "Class C"
  return "Class D"
}

function isActiveScoringMonth(distance: number, penalties: number) {
  return distance > 0 || penalties < 0
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
  const penalties = draft.tirePenaltyPoints + draft.suspensionPenaltyPoints
  const safeDrivingBonus = safeDrivingBonusFor(penalties)
  const netScore = draft.productivityPoints + safeDrivingBonus + penalties

  return {
    ...draft,
    totalMileageKm: roundKm(draft.totalMileageKm),
    safeDrivingBonus,
    netScore,
    matrixClass: monthlyMatrixClassFor(netScore),
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

  const [mileageLogs, pairings, tireRows, scrapRows, suspensionRows] =
    await Promise.all([
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
        assetId: tirePenaltiesTable.assetId,
        assetName: assetsTable.assetName,
        assetType: assetsTable.assetType,
        points: sum(tirePenaltiesTable.amount),
      })
      .from(tirePenaltiesTable)
      .innerJoin(assetsTable, eq(tirePenaltiesTable.assetId, assetsTable.id))
      .where(
        and(
          sql`(${tirePenaltiesTable.date})::date >= ${startOfMonth}::date`,
          sql`(${tirePenaltiesTable.date})::date <= ${endOfMonth}::date`
        )
      )
      .groupBy(
        tirePenaltiesTable.assetId,
        assetsTable.assetName,
        assetsTable.assetType
      ),
    db
      .select({
        assetId: mechanicalSparesTable.assetId,
        assetName: assetsTable.assetName,
        assetType: assetsTable.assetType,
        materialName: mechanicalSparesTable.materialName,
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

  for (const row of scrapRows) {
    rememberAsset({
      id: row.assetId,
      name: row.assetName,
      assetType: row.assetType,
    })

    const deduction = asDeduction(toFiniteNumber(row.points))
    tireByAsset.set(row.assetId, (tireByAsset.get(row.assetId) ?? 0) + deduction)
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

  for (const row of suspensionRows) {
    const asset: AssetInfo = {
      id: row.assetId,
      name: row.assetName,
      assetType: row.assetType,
    }
    rememberAsset(asset)

    const deduction = suspensionPenaltyPointsForKind(
      row.materialName,
      entityTypeForAsset(row.assetId, asset)
    )
    if (deduction === 0) continue

    suspensionByAsset.set(
      row.assetId,
      (suspensionByAsset.get(row.assetId) ?? 0) + deduction
    )
    chargeDrivers(row.assetId, deduction, suspensionByDriver)
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

async function loadYtdWindow(year: number, endMonth: number) {
  const { startOfMonth: ytdStart } = monthBounds(year, 1)
  const { endOfMonth: ytdEnd } = monthBounds(year, endMonth)

  const [
    assets,
    activeDrivers,
    mileageLogs,
    pairings,
    tireRows,
    scrapRows,
    suspensionRows,
  ] = await Promise.all([
      db
        .select({
          id: assetsTable.id,
          name: assetsTable.assetName,
          assetType: assetsTable.assetType,
        })
        .from(assetsTable),
      db
        .select({
          id: driversTable.id,
          name: driversTable.name,
        })
        .from(driversTable)
        .where(eq(driversTable.isActive, true))
        .orderBy(asc(driversTable.name)),
      db
        .select({
          assetId: mileageLogsTable.assetId,
          date: mileageLogsTable.date,
          odometer: mileageLogsTable.odometer,
        })
        .from(mileageLogsTable)
        .where(
          and(
            gte(mileageLogsTable.date, ytdStart),
            lte(mileageLogsTable.date, ytdEnd)
          )
        )
        .orderBy(asc(mileageLogsTable.assetId), asc(mileageLogsTable.date)),
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
      db
        .select({
          assetId: tireIncidentsTable.assetId,
          date: sql<string>`(${tireIncidentsTable.incidentDate})::date::text`,
          month: sql<number>`extract(month from (${tireIncidentsTable.incidentDate})::date)::int`,
          reason: tireIncidentsTable.penaltyType,
          points: tireIncidentsTable.penaltyPoints,
        })
        .from(tireIncidentsTable)
        .where(
          and(
            sql`(${tireIncidentsTable.incidentDate})::date >= ${ytdStart}::date`,
            sql`(${tireIncidentsTable.incidentDate})::date <= ${ytdEnd}::date`
          )
        ),
      db
        .select({
          assetId: tirePenaltiesTable.assetId,
          date: sql<string>`(${tirePenaltiesTable.date})::date::text`,
          month: sql<number>`extract(month from (${tirePenaltiesTable.date})::date)::int`,
          reason: tirePenaltiesTable.reason,
          visualId: tirePenaltiesTable.visualId,
          points: tirePenaltiesTable.amount,
        })
        .from(tirePenaltiesTable)
        .where(
          and(
            sql`(${tirePenaltiesTable.date})::date >= ${ytdStart}::date`,
            sql`(${tirePenaltiesTable.date})::date <= ${ytdEnd}::date`
          )
        ),
      db
        .select({
          assetId: mechanicalSparesTable.assetId,
          fitmentDate: mechanicalSparesTable.fitmentDate,
          jobCardNo: mechanicalSparesTable.jobCardNo,
          materialName: mechanicalSparesTable.materialName,
        })
        .from(mechanicalSparesTable)
        .where(
          and(
            gte(mechanicalSparesTable.fitmentDate, ytdStart),
            lte(mechanicalSparesTable.fitmentDate, ytdEnd),
            sql`upper(${mechanicalSparesTable.tier1}) = 'SUSPENSION'`
          )
        ),
    ])

  const trucksById = new Map<number, AssetInfo>()

  for (const asset of assets) {
    if (!isTruckAsset(asset)) continue
    trucksById.set(asset.id, asset)
  }

  for (const pairing of pairings) {
    trucksById.set(pairing.truck.id, {
      id: pairing.truck.id,
      name: pairing.truck.assetName,
      assetType: pairing.truck.assetType,
    })
  }

  const trucks = [...trucksById.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id - b.id
  )
  const truckIds = new Set(trucks.map((truck) => truck.id))

  const odometersByTruckMonth = new Map<string, Array<string | number>>()

  for (const row of mileageLogs) {
    if (!truckIds.has(row.assetId)) continue

    const month = calendarMonthFromDate(row.date)
    if (month < 1 || month > endMonth) continue

    const key = assetMonthKey(row.assetId, month)
    const readings = odometersByTruckMonth.get(key) ?? []
    readings.push(row.odometer)
    odometersByTruckMonth.set(key, readings)
  }

  const kmByTruckMonth = new Map<string, number>()

  for (const [key, odometers] of odometersByTruckMonth) {
    kmByTruckMonth.set(key, sumValidDailyDeltas(odometers))
  }

  const pairingsByMonth = new Map<number, typeof pairings>()

  for (const pairing of pairings) {
    const month = calendarMonthFromDate(pairing.activeMonth)
    if (month < 1 || month > endMonth) continue

    const monthPairings = pairingsByMonth.get(month) ?? []
    monthPairings.push(pairing)
    pairingsByMonth.set(month, monthPairings)
  }

  const tireByAssetMonth = new Map<string, number>()
  const detailsByAssetMonth = new Map<string, PenaltyDetail[]>()

  function addTirePenalty(row: {
    assetId: number
    month: number
    date: string
    reason: string
    points: string | number | null
    visualId?: string | null
  }) {
    const month = toFiniteNumber(row.month)
    if (month < 1 || month > endMonth) return

    const amount = asDeduction(toFiniteNumber(row.points))
    const key = assetMonthKey(row.assetId, month)
    tireByAssetMonth.set(key, (tireByAssetMonth.get(key) ?? 0) + amount)

    const detail: PenaltyDetail = {
      date: row.date,
      reason: row.reason,
      amount,
    }
    if (row.visualId) {
      detail.visualId = row.visualId
    }

    const list = detailsByAssetMonth.get(key) ?? []
    list.push(detail)
    detailsByAssetMonth.set(key, list)
  }

  for (const row of tireRows) addTirePenalty(row)
  for (const row of scrapRows) addTirePenalty(row)

  const assetsById = new Map<number, AssetInfo>()
  const trailerIds = new Set<number>()

  for (const asset of assets) {
    assetsById.set(asset.id, asset)
  }

  for (const pairing of pairings) {
    assetsById.set(pairing.truck.id, {
      id: pairing.truck.id,
      name: pairing.truck.assetName,
      assetType: pairing.truck.assetType,
    })
    assetsById.set(pairing.trailer.id, {
      id: pairing.trailer.id,
      name: pairing.trailer.assetName,
      assetType: pairing.trailer.assetType,
    })
    trailerIds.add(pairing.trailer.id)
  }

  const penaltyByAssetMonth = new Map<string, number>(tireByAssetMonth)

  for (const row of suspensionRows) {
    const month = calendarMonthFromDate(row.fitmentDate)
    if (month < 1 || month > endMonth) continue

    const asset = assetsById.get(row.assetId)
    if (!asset) continue

    const kind: "Truck" | "Trailer" = trucksById.has(row.assetId)
      ? "Truck"
      : trailerIds.has(row.assetId) || isTrailerAsset(asset)
        ? "Trailer"
        : "Truck"
    const amount = suspensionPenaltyPointsForKind(row.materialName, kind)
    if (amount === 0) continue

    const key = assetMonthKey(row.assetId, month)
    penaltyByAssetMonth.set(key, (penaltyByAssetMonth.get(key) ?? 0) + amount)

    const list = detailsByAssetMonth.get(key) ?? []
    list.push({
      date: toIsoDate(row.fitmentDate),
      reason: `${row.materialName} - ${row.jobCardNo}`,
      amount,
    })
    detailsByAssetMonth.set(key, list)
  }

  for (const [key, details] of detailsByAssetMonth) {
    detailsByAssetMonth.set(key, sortPenaltyDetails(details))
  }

  return {
    endMonth,
    trucks,
    activeDrivers,
    kmByTruckMonth,
    pairingsByMonth,
    penaltyByAssetMonth,
    detailsByAssetMonth,
  }
}

type YtdWindow = Awaited<ReturnType<typeof loadYtdWindow>>

function assetPenalty(
  penaltyByAssetMonth: Map<string, number>,
  assetId: number,
  month: number
) {
  return penaltyByAssetMonth.get(assetMonthKey(assetId, month)) ?? 0
}

function assetPenaltyDetails(
  detailsByAssetMonth: Map<string, PenaltyDetail[]>,
  assetId: number,
  month: number
) {
  const details = detailsByAssetMonth.get(assetMonthKey(assetId, month))
  return details ? details.slice() : []
}

function collectAssetPenaltyDetails(
  detailsByAssetMonth: Map<string, PenaltyDetail[]>,
  assets: Array<{ id: number }>,
  month: number
) {
  return sortPenaltyDetails(
    assets.flatMap((asset) =>
      assetPenaltyDetails(detailsByAssetMonth, asset.id, month)
    )
  )
}

function monthPairingsForTruck(
  pairingsByMonth: YtdWindow["pairingsByMonth"],
  truckId: number,
  month: number
) {
  return (pairingsByMonth.get(month) ?? []).filter(
    (pairing) => pairing.truck.id === truckId
  )
}

function monthPairingsForDriver(
  pairingsByMonth: YtdWindow["pairingsByMonth"],
  driverId: number,
  month: number
) {
  return (pairingsByMonth.get(month) ?? []).filter(
    (pairing) => pairing.driver.id === driverId
  )
}

function hasMotiveUnitActivity(row: {
  distance: number
  driverName: string
  trailerName: string
  truckPen: number
  trailerPen: number
}) {
  return (
    row.distance > 0 ||
    row.driverName.length > 0 ||
    row.trailerName.length > 0 ||
    row.truckPen !== 0 ||
    row.trailerPen !== 0
  )
}

export async function calculateMotiveUnitYield(
  year: number,
  endMonth: number
): Promise<MotiveUnitYieldScore[]> {
  assertCalendarMonth(year, endMonth)

  const window = await loadYtdWindow(year, endMonth)

  return window.trucks
    .map((truck) => {
      const monthlyData: MotiveUnitMonthYield[] = []
      let ytdNetScore = 0
      let activeMonths = 0

      for (let month = 1; month <= window.endMonth; month++) {
        const pairings = monthPairingsForTruck(
          window.pairingsByMonth,
          truck.id,
          month
        )
        const distance = window.kmByTruckMonth.get(assetMonthKey(truck.id, month)) ?? 0
        const distancePoints = productivityPointsForKm(distance)
        const pairedTrailers = uniqueById(pairings.map((pairing) => pairing.trailer))
        const truckPenaltyDetails = assetPenaltyDetails(
          window.detailsByAssetMonth,
          truck.id,
          month
        )
        const trailerPenaltyDetails = collectAssetPenaltyDetails(
          window.detailsByAssetMonth,
          pairedTrailers,
          month
        )
        const truckPen = assetPenalty(window.penaltyByAssetMonth, truck.id, month)
        const trailerPen = pairedTrailers.reduce(
          (total, trailer) =>
            total + assetPenalty(window.penaltyByAssetMonth, trailer.id, month),
          0
        )
        const penalties = truckPen + trailerPen
        const safeDrivingBonus = safeDrivingBonusFor(penalties)
        const netScore = distancePoints + safeDrivingBonus + penalties
        const row: MotiveUnitMonthYield = {
          month,
          driverName: uniqueJoinedNames(pairings.map((pairing) => pairing.driver.name)),
          trailerName: uniqueJoinedNames(
            pairings.map((pairing) => pairing.trailer.assetName)
          ),
          distance: roundKm(distance),
          prodPts: distancePoints,
          safeDrivingBonus,
          truckPen,
          trailerPen,
          truckPenaltyDetails,
          trailerPenaltyDetails,
          netScore,
        }

        if (!hasMotiveUnitActivity(row)) continue

        monthlyData.push(row)
        ytdNetScore += netScore
        if (isActiveScoringMonth(distance, penalties)) {
          activeMonths += 1
        }
      }

      const averageMonthlyScore = roundToOneDecimal(
        ytdNetScore / (activeMonths || 1)
      )

      return {
        id: truck.id,
        displayName: truck.name,
        ytdNetScore,
        averageMonthlyScore,
        currentClass: matrixClassFor(averageMonthlyScore, activeMonths),
        monthlyData,
      }
    })
    .sort(
      (a, b) => a.displayName.localeCompare(b.displayName) || a.id - b.id
    )
}

export async function calculateOperatorYield(
  year: number,
  endMonth: number
): Promise<OperatorYieldScore[]> {
  assertCalendarMonth(year, endMonth)

  const window = await loadYtdWindow(year, endMonth)

  return window.activeDrivers
    .map((driver) => {
      const monthlyData: OperatorMonthYield[] = []
      let ytdNetScore = 0
      let activeMonths = 0

      for (let month = 1; month <= window.endMonth; month++) {
        const pairings = monthPairingsForDriver(
          window.pairingsByMonth,
          driver.id,
          month
        )
        if (pairings.length === 0) continue

        const trucks = uniqueById(pairings.map((pairing) => pairing.truck))
        const trailers = uniqueById(pairings.map((pairing) => pairing.trailer))
        // Sum every truck's smoothed distance first, then score the driver
        // once so two mid-yield trucks can still clear a distance band.
        const distance = trucks.reduce(
          (total, truck) =>
            total +
            (window.kmByTruckMonth.get(assetMonthKey(truck.id, month)) ?? 0),
          0
        )
        const distancePoints = productivityPointsForKm(distance)
        const penaltyDetails = collectAssetPenaltyDetails(
          window.detailsByAssetMonth,
          [...trucks, ...trailers],
          month
        )
        const penalties =
          trucks.reduce(
            (total, truck) =>
              total + assetPenalty(window.penaltyByAssetMonth, truck.id, month),
            0
          ) +
          trailers.reduce(
            (total, trailer) =>
              total + assetPenalty(window.penaltyByAssetMonth, trailer.id, month),
            0
          )
        const safeDrivingBonus = safeDrivingBonusFor(penalties)
        const netScore = distancePoints + safeDrivingBonus + penalties

        monthlyData.push({
          month,
          trucksOperated: uniqueJoinedNames(trucks.map((truck) => truck.assetName)),
          trailersPulled: uniqueJoinedNames(
            trailers.map((trailer) => trailer.assetName)
          ),
          distance: roundKm(distance),
          prodPts: distancePoints,
          safeDrivingBonus,
          penalties,
          penaltyDetails,
          netScore,
        })
        ytdNetScore += netScore
        if (isActiveScoringMonth(distance, penalties)) {
          activeMonths += 1
        }
      }

      const averageMonthlyScore = roundToOneDecimal(
        ytdNetScore / (activeMonths || 1)
      )

      return {
        id: driver.id,
        displayName: driver.name,
        ytdNetScore,
        averageMonthlyScore,
        currentClass: matrixClassFor(averageMonthlyScore, activeMonths),
        monthlyData,
      }
    })
    .sort(
      (a, b) => a.displayName.localeCompare(b.displayName) || a.id - b.id
    )
}
