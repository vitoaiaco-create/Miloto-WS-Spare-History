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
