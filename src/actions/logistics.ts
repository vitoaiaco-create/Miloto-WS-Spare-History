"use server"

import { auth } from "@clerk/nextjs/server"
import { and, desc, eq, ne, not, sql, type SQL } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import {
  assetsTable,
  monthlyAssetDistancesTable,
  tirePenaltiesTable,
} from "@/db/schema"
import { trailerIdentityFilter } from "@/lib/fleet-identity"
import { toCanonicalFleetNumber } from "@/lib/spreadsheet"

const upsertMonthlyManualDistanceSchema = z.object({
  assetId: z.number({ error: "Asset is required" }).int().positive(),
  year: z.number({ error: "Year is required" }).int().min(2000).max(2100),
  month: z
    .number({ error: "Month is required" })
    .int()
    .min(1, "Month must be between 1 and 12")
    .max(12, "Month must be between 1 and 12"),
  // `null` clears the override so scoring falls back to automated hops.
  manualDistance: z
    .number({ error: "Manual distance must be a number" })
    .int("Manual distance must be a whole number")
    .nonnegative("Manual distance cannot be negative")
    .max(200_000, "Manual distance is implausibly high")
    .nullable(),
})

type UpsertMonthlyManualDistanceInput = z.infer<
  typeof upsertMonthlyManualDistanceSchema
>

export type UpsertMonthlyManualDistanceResult = {
  assetId: number
  monthYear: string
  manualDistance: number | null
}

async function requireLogisticsAccess() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    throw new Error("Unauthorized")
  }

  if (sessionClaims?.metadata?.role === "oils_only") {
    throw new Error("Unauthorized")
  }

  const isAdmin = sessionClaims?.metadata?.role === "admin"
  const hasLogisticsModule =
    sessionClaims?.metadata?.modules?.includes("logistics_analytics") ?? false

  if (!isAdmin && !hasLogisticsModule) {
    throw new Error("Unauthorized")
  }
}

function toFirstOfMonthIso(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`
}

// Writes or clears a monthly mileage override. Automated odometer hops in
// `mileage_logs` are left untouched; scoring uses the override when it is
// not null.
export async function upsertMonthlyManualDistance(
  input: UpsertMonthlyManualDistanceInput
): Promise<UpsertMonthlyManualDistanceResult> {
  await requireLogisticsAccess()

  const data = upsertMonthlyManualDistanceSchema.parse(input)
  const monthYear = toFirstOfMonthIso(data.year, data.month)

  const [asset] = await db
    .select({ id: assetsTable.id })
    .from(assetsTable)
    .where(eq(assetsTable.id, data.assetId))
    .limit(1)

  if (!asset) {
    throw new Error("Asset not found")
  }

  if (data.manualDistance === null) {
    await db
      .delete(monthlyAssetDistancesTable)
      .where(
        and(
          eq(monthlyAssetDistancesTable.assetId, data.assetId),
          eq(monthlyAssetDistancesTable.monthYear, monthYear)
        )
      )

    revalidatePath("/logistics")

    return {
      assetId: data.assetId,
      monthYear,
      manualDistance: null,
    }
  }

  const updatedAt = new Date()

  const [row] = await db
    .insert(monthlyAssetDistancesTable)
    .values({
      assetId: data.assetId,
      monthYear,
      manualDistance: data.manualDistance,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        monthlyAssetDistancesTable.assetId,
        monthlyAssetDistancesTable.monthYear,
      ],
      set: {
        manualDistance: data.manualDistance,
        updatedAt,
      },
    })
    .returning({
      assetId: monthlyAssetDistancesTable.assetId,
      monthYear: monthlyAssetDistancesTable.monthYear,
      manualDistance: monthlyAssetDistancesTable.manualDistance,
    })

  if (!row) {
    throw new Error("Failed to save mileage override")
  }

  revalidatePath("/logistics")

  return {
    assetId: row.assetId,
    monthYear: row.monthYear,
    manualDistance: row.manualDistance,
  }
}

const getTireDamagesByAssetSchema = z.object({
  year: z.number({ error: "Year is required" }).int().min(2000).max(2100),
})

export type TireDamageAssetCount = {
  assetId: string
  assetName: string
  damageCount: number
}

export type TireDamagesByFleetType = {
  trucks: TireDamageAssetCount[]
  trailers: TireDamageAssetCount[]
}

// Cranes match the generic "motive" definition (anything that isn't a
// trailer — see `trailerIdentityFilter` in src/actions/analytics.ts), but
// they are not Trucks and must never appear in the Tyre Damages chart's
// Motive Units dataset. Excluded explicitly rather than relying on the
// trailer filter alone.
function tireDamageTruckFilter(): SQL {
  const filter = and(
    not(trailerIdentityFilter()),
    ne(assetsTable.assetType, "Crane")
  )

  if (!filter) {
    throw new Error("Truck identity filter is required")
  }

  return filter
}

// Repeat tire-damage offenders for a calendar year, backing the Tyre
// Damages tab on the Logistics Analytics dashboard. An "operational
// damage" is any `tire_penalties` row with a non-zero `amount` — the
// processed scrap CSV can in principle store a deduction as either a
// positive or negative figure (see `tirePenaltyRowSchema` in
// src/lib/validations.ts), so this checks magnitude via `ne(..., 0)`
// rather than assuming a sign. Assets are grouped and counted, then
// trimmed to those with 2+ damages for the year and split into Trucks
// (motive units, Cranes excluded) and Trailers (towed units).
async function queryTireDamageCounts(
  identityFilter: SQL,
  dateFilter: SQL
): Promise<TireDamageAssetCount[]> {
  const damageCountExpr = sql<number>`count(*)`

  const rows = await db
    .select({
      assetName: assetsTable.assetName,
      damageCount: damageCountExpr.mapWith(Number),
    })
    .from(tirePenaltiesTable)
    .innerJoin(assetsTable, eq(tirePenaltiesTable.assetId, assetsTable.id))
    .where(and(dateFilter, identityFilter, ne(tirePenaltiesTable.amount, 0)))
    .groupBy(assetsTable.assetName)
    .having(sql`count(*) >= 2`)
    .orderBy(desc(damageCountExpr))

  return rows.map((row) => ({
    assetId: toCanonicalFleetNumber(row.assetName),
    assetName: row.assetName,
    damageCount: row.damageCount,
  }))
}

export async function getTireDamagesByAsset(
  year: number
): Promise<TireDamagesByFleetType> {
  await requireLogisticsAccess()

  const data = getTireDamagesByAssetSchema.parse({ year })
  const yearStart = `${data.year}-01-01`
  const yearEnd = `${data.year}-12-31`
  const dateFilter = and(
    sql`(${tirePenaltiesTable.date})::date >= ${yearStart}::date`,
    sql`(${tirePenaltiesTable.date})::date <= ${yearEnd}::date`
  )

  if (!dateFilter) {
    throw new Error("Tire damage date filter is required")
  }

  const [trucks, trailers] = await Promise.all([
    queryTireDamageCounts(tireDamageTruckFilter(), dateFilter),
    queryTireDamageCounts(trailerIdentityFilter(), dateFilter),
  ])

  return { trucks, trailers }
}

const getTyreDamageIncidentDetailsSchema = z.object({
  year: z.number({ error: "Year is required" }).int().min(2000).max(2100),
  assetId: z.string().trim().min(1).max(100).optional(),
  driverName: z.string().trim().min(1).max(255).optional(),
})

type GetTyreDamageIncidentDetailsInput = z.infer<
  typeof getTyreDamageIncidentDetailsSchema
>

// One operational tyre damage (`tire_penalties` row with a non-zero amount).
// `tire_penalties` only stores the date, reason, penalty amount and the
// source `visualId`; tyre position / axle / brand / serial / size / cost /
// mileage are not captured in the schema, so they are intentionally absent.
export type TyreDamageIncidentDetail = {
  id: number
  visualId: string
  /** ISO calendar date (YYYY-MM-DD). */
  date: string
  /** Canonical fleet number, e.g. `MTL106` or `MT124`. */
  assetId: string
  assetName: string
  assetType: "Truck" | "Trailer"
  reason: string
  penaltyPoints: number
  /** Driver(s) paired to the truck/trailer in `monthly_pairings` that month. */
  drivers: string[]
  /** The other half of the pairing (trailer for a truck, truck for a trailer). */
  pairedAssets: string[]
}

export type TyreDamageIncidentDetailsResult =
  | { success: true; data: TyreDamageIncidentDetail[] }
  | { success: false; error: string }

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string) {
  const set = map.get(key) ?? new Set<string>()
  set.add(value)
  map.set(key, set)
}

function sortedValues(set: Set<string> | undefined) {
  return [...(set ?? [])].sort((a, b) => a.localeCompare(b))
}

type YearTyreDamageData = {
  /** Every operational tyre damage for the year, newest first. */
  incidents: TyreDamageIncidentDetail[]
  /** Unique driver names present in `monthly_pairings` for the year. */
  pairedDriverNames: string[]
}

// Shared loader behind the per-asset and per-driver Tyre Damages views.
// Drivers are resolved from `monthly_pairings` (same join as
// src/lib/logistics-scoring.ts: truck + trailer + driver for the
// incident's calendar month), since `tire_penalties` doesn't store a
// driver itself. Cranes are excluded to match the Motive Units chart,
// which never includes them.
async function loadYearTyreDamageData(
  year: number
): Promise<YearTyreDamageData> {
  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`

  const [penaltyRows, pairings] = await Promise.all([
    db
      .select({
        id: tirePenaltiesTable.id,
        visualId: tirePenaltiesTable.visualId,
        date: sql<string>`(${tirePenaltiesTable.date})::date::text`,
        amount: tirePenaltiesTable.amount,
        reason: tirePenaltiesTable.reason,
        assetName: assetsTable.assetName,
        assetType: assetsTable.assetType,
      })
      .from(tirePenaltiesTable)
      .innerJoin(assetsTable, eq(tirePenaltiesTable.assetId, assetsTable.id))
      .where(
        and(
          sql`(${tirePenaltiesTable.date})::date >= ${yearStart}::date`,
          sql`(${tirePenaltiesTable.date})::date <= ${yearEnd}::date`,
          ne(tirePenaltiesTable.amount, 0)
        )
      )
      .orderBy(
        desc(sql`(${tirePenaltiesTable.date})::date`),
        desc(tirePenaltiesTable.id)
      ),
    db.query.monthlyPairingsTable.findMany({
      where: { activeMonth: { gte: yearStart, lte: yearEnd } },
      with: { truck: true, trailer: true, driver: true },
    }),
  ])

  // Keyed by `<assetName>:<YYYY-MM>`.
  const driversByAssetMonth = new Map<string, Set<string>>()
  const pairedByAssetMonth = new Map<string, Set<string>>()
  const pairedDriverNames = new Set<string>()
  for (const pairing of pairings) {
    const month = pairing.activeMonth.slice(0, 7)
    const truckKey = `${pairing.truck.assetName}:${month}`
    const trailerKey = `${pairing.trailer.assetName}:${month}`
    const driver = pairing.driver.name
    if (driver.trim().length > 0) {
      pairedDriverNames.add(driver)
      addToSetMap(driversByAssetMonth, truckKey, driver)
      addToSetMap(driversByAssetMonth, trailerKey, driver)
    }
    addToSetMap(
      pairedByAssetMonth,
      truckKey,
      toCanonicalFleetNumber(pairing.trailer.assetName)
    )
    addToSetMap(
      pairedByAssetMonth,
      trailerKey,
      toCanonicalFleetNumber(pairing.truck.assetName)
    )
  }

  const incidents: TyreDamageIncidentDetail[] = []
  for (const row of penaltyRows) {
    if (row.assetType === "Crane") continue

    const key = `${row.assetName}:${row.date.slice(0, 7)}`
    const isTrailer =
      row.assetType === "Trailer" || /TRAILER/i.test(row.assetName)

    incidents.push({
      id: row.id,
      visualId: row.visualId,
      date: row.date,
      assetId: toCanonicalFleetNumber(row.assetName),
      assetName: row.assetName,
      assetType: isTrailer ? "Trailer" : "Truck",
      reason: row.reason,
      penaltyPoints: row.amount,
      drivers: sortedValues(driversByAssetMonth.get(key)),
      pairedAssets: sortedValues(pairedByAssetMonth.get(key)),
    })
  }

  return { incidents, pairedDriverNames: sortedValues(pairedDriverNames) }
}

// Full incident list behind a Tyre Damages bar, newest first. Returns plain
// JSON and converts failures into `{ success: false }` rather than throwing.
export async function getTyreDamageIncidentDetails(
  input: GetTyreDamageIncidentDetailsInput
): Promise<TyreDamageIncidentDetailsResult> {
  try {
    await requireLogisticsAccess()

    const parsed = getTyreDamageIncidentDetailsSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid request",
      }
    }

    const { year, assetId, driverName } = parsed.data
    const { incidents } = await loadYearTyreDamageData(year)

    const wantedAsset = assetId ? toCanonicalFleetNumber(assetId) : null
    const wantedDriver = driverName?.trim().toLowerCase() ?? null

    const data = incidents.filter((incident) => {
      if (wantedAsset && incident.assetId !== wantedAsset) return false
      if (
        wantedDriver &&
        !incident.drivers.some(
          (name) => name.trim().toLowerCase() === wantedDriver
        )
      ) {
        return false
      }
      return true
    })

    return { success: true, data }
  } catch (error) {
    console.error("getTyreDamageIncidentDetails failed", error)
    return {
      success: false,
      error:
        error instanceof Error && error.message === "Unauthorized"
          ? "You are not authorised to view tyre damage incidents."
          : "Could not load tyre damage incidents.",
    }
  }
}

export type TireDamageDriverCount = {
  driverName: string
  truckDamages: number
  trailerDamages: number
  /** `truckDamages + trailerDamages`. */
  totalDamages: number
  /** Unique canonical truck IDs (`MTL...`) involved. */
  truckIds: string[]
  /** Unique canonical trailer IDs (`MT...`) involved. */
  trailerIds: string[]
}

// Combined Truck + Trailer operational tyre damages per driver for a year.
// Each incident is credited to every driver paired to that asset in the
// incident's month (identical to the modal's driver filter, so bar totals
// always match the incident list). Every driver present in
// `monthly_pairings` for the year is included, even with 0 damages, so
// the driver filter can select any active driver.
export async function getTireDamagesByDriver(
  year: number
): Promise<TireDamageDriverCount[]> {
  await requireLogisticsAccess()

  const data = getTireDamagesByAssetSchema.parse({ year })
  const { incidents, pairedDriverNames } = await loadYearTyreDamageData(
    data.year
  )

  type Accumulator = {
    driverName: string
    truckDamages: number
    trailerDamages: number
    truckIds: Set<string>
    trailerIds: Set<string>
  }

  // Keyed by lower-cased trimmed name, matching the modal's driver match.
  const byDriver = new Map<string, Accumulator>()
  for (const name of pairedDriverNames) {
    const key = name.trim().toLowerCase()
    if (byDriver.has(key)) continue
    byDriver.set(key, {
      driverName: name.trim(),
      truckDamages: 0,
      trailerDamages: 0,
      truckIds: new Set(),
      trailerIds: new Set(),
    })
  }

  for (const incident of incidents) {
    const credited = new Set(
      incident.drivers.map((name) => name.trim().toLowerCase())
    )
    for (const key of credited) {
      const entry = byDriver.get(key)
      if (!entry) continue
      if (incident.assetType === "Trailer") {
        entry.trailerDamages += 1
        entry.trailerIds.add(incident.assetId)
      } else {
        entry.truckDamages += 1
        entry.truckIds.add(incident.assetId)
      }
    }
  }

  return [...byDriver.values()]
    .map((entry) => ({
      driverName: entry.driverName,
      truckDamages: entry.truckDamages,
      trailerDamages: entry.trailerDamages,
      totalDamages: entry.truckDamages + entry.trailerDamages,
      truckIds: sortedValues(entry.truckIds),
      trailerIds: sortedValues(entry.trailerIds),
    }))
    .sort(
      (a, b) =>
        b.totalDamages - a.totalDamages ||
        a.driverName.localeCompare(b.driverName)
    )
}
