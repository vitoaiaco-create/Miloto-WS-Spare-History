"use server"

import { auth } from "@clerk/nextjs/server"
import {
  and,
  between,
  eq,
  ilike,
  not,
  or,
  sql,
  sum,
} from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import {
  assetsTable,
  mechanicalSparesTable,
  monthlyFleetKmTable,
} from "@/db/schema"

const upsertMonthlyFleetKmSchema = z.object({
  year: z.number({ error: "Year is required" }).int().min(2000).max(2100),
  month: z
    .number({ error: "Month is required" })
    .int()
    .min(1, "Month must be between 1 and 12")
    .max(12, "Month must be between 1 and 12"),
  totalKm: z
    .number({ error: "Total KM must be a number" })
    .int("Total KM must be a whole number")
    .nonnegative("Total KM cannot be negative"),
})

type UpsertMonthlyFleetKmInput = z.infer<typeof upsertMonthlyFleetKmSchema>

export type UpsertMonthlyFleetKmResult = {
  id: number
  monthYear: string
  totalKm: number
  updatedAt: Date
}

// Manual fleet-KM entry lives on Workshop Analytics, so this action is
// gated to staff with that module (or admins). `oils_only` is rejected
// even if a module claim is present — see src/app/page.tsx.
async function requireWorkshopAnalyticsAccess() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    throw new Error("Unauthorized")
  }

  if (sessionClaims?.metadata?.role === "oils_only") {
    throw new Error("Unauthorized")
  }

  const isAdmin = sessionClaims?.metadata?.role === "admin"
  const hasAnalyticsModule =
    sessionClaims?.metadata?.modules?.includes("workshop_analytics") ?? false

  if (!isAdmin && !hasAnalyticsModule) {
    throw new Error("Unauthorized")
  }
}

function toFirstOfMonthIso(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

const getYtdAnalyticsSchema = z.object({
  year: z.number({ error: "Year is required" }).int().min(2000).max(2100),
  fleetType: z.enum(["combined", "motive", "towed"]),
})

type GetYtdAnalyticsInput = z.infer<typeof getYtdAnalyticsSchema>

export type AnalyticsFleetType = GetYtdAnalyticsInput["fleetType"]

export type YtdAnalyticsPoint = {
  month: string
  totalUsd: number
  cpk: number
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function monthNumberFromIsoDate(value: string) {
  return Number(value.slice(5, 7))
}

// Source identities look like "MT124(TRAILER124)", but ingestion stores
// trailers as `MT124` with `assetType = "Trailer"`. Match both so the
// motive/towed split still works after canonicalization.
function trailerIdentityFilter() {
  const filter = or(
    ilike(assetsTable.assetName, "%TRAILER%"),
    eq(assetsTable.assetType, "Trailer")
  )

  if (!filter) {
    throw new Error("Trailer identity filter is required")
  }

  return filter
}

function fleetTypeFilter(fleetType: AnalyticsFleetType) {
  if (fleetType === "motive") return not(trailerIdentityFilter())
  if (fleetType === "towed") return trailerIdentityFilter()
  return undefined
}

// Inserts a monthly fleet KM total, or overwrites the existing row for
// that calendar month. `monthYear` is always stored as the 1st of the
// month so the unique index in `src/db/schema.ts` can key the upsert.
export async function upsertMonthlyFleetKm(
  input: UpsertMonthlyFleetKmInput
): Promise<UpsertMonthlyFleetKmResult> {
  await requireWorkshopAnalyticsAccess()

  const data = upsertMonthlyFleetKmSchema.parse(input)
  const monthYear = toFirstOfMonthIso(data.year, data.month)
  const updatedAt = new Date()

  const [row] = await db
    .insert(monthlyFleetKmTable)
    .values({
      monthYear,
      totalKm: data.totalKm,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: monthlyFleetKmTable.monthYear,
      set: {
        totalKm: data.totalKm,
        updatedAt,
      },
    })
    .returning({
      id: monthlyFleetKmTable.id,
      monthYear: monthlyFleetKmTable.monthYear,
      totalKm: monthlyFleetKmTable.totalKm,
      updatedAt: monthlyFleetKmTable.updatedAt,
    })

  if (!row) {
    throw new Error("Failed to save monthly fleet KM")
  }

  revalidatePath("/analytics")

  return row
}

// Year-to-date spend vs cost-per-km for Workshop Analytics. KM totals are
// fleet-wide (one `monthly_fleet_km` row per calendar month); USD is
// filtered to motive/towed when requested.
export async function getYtdAnalytics(
  year: number,
  fleetType: AnalyticsFleetType
): Promise<YtdAnalyticsPoint[]> {
  await requireWorkshopAnalyticsAccess()

  const data = getYtdAnalyticsSchema.parse({ year, fleetType })
  const yearStart = `${data.year}-01-01`
  const yearEnd = `${data.year}-12-31`
  const fleetKmYearEnd = `${data.year}-12-01`
  const monthExpr = sql`extract(month from ${mechanicalSparesTable.fitmentDate})`
  const identityFilter = fleetTypeFilter(data.fleetType)
  const spendInYear = between(
    mechanicalSparesTable.fitmentDate,
    yearStart,
    yearEnd
  )

  const [spendRows, kmRows] = await Promise.all([
    db
      .select({
        month: monthExpr.mapWith(Number),
        totalUsd: sum(mechanicalSparesTable.costUsd),
      })
      .from(mechanicalSparesTable)
      .innerJoin(
        assetsTable,
        eq(mechanicalSparesTable.assetId, assetsTable.id)
      )
      .where(
        identityFilter ? and(spendInYear, identityFilter) : spendInYear
      )
      .groupBy(monthExpr)
      .orderBy(monthExpr),
    db
      .select({
        monthYear: monthlyFleetKmTable.monthYear,
        totalKm: monthlyFleetKmTable.totalKm,
      })
      .from(monthlyFleetKmTable)
      .where(
        between(monthlyFleetKmTable.monthYear, yearStart, fleetKmYearEnd)
      ),
  ])

  const usdByMonth = new Map<number, number>()
  for (const row of spendRows) {
    usdByMonth.set(row.month, toNumber(row.totalUsd))
  }

  const kmByMonth = new Map<number, number>()
  for (const row of kmRows) {
    kmByMonth.set(monthNumberFromIsoDate(row.monthYear), row.totalKm)
  }

  return MONTH_LABELS.map((month, index) => {
    const totalUsd = usdByMonth.get(index + 1) ?? 0
    const totalKm = kmByMonth.get(index + 1) ?? 0

    return {
      month,
      totalUsd,
      cpk: totalKm > 0 ? totalUsd / totalKm : 0,
    }
  })
}
