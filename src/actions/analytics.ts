"use server"

import { auth } from "@clerk/nextjs/server"
import {
  and,
  between,
  eq,
  gte,
  ilike,
  lt,
  not,
  or,
  sql,
  sum,
  type SQL,
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

function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function daysInCalendarMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function weekOfMonth(day: number) {
  return Math.ceil(day / 7)
}

// Calendar days from 1 Jan through the last day of the previous month.
// January has no completed YTD months, so the baseline is 0.
function ytdElapsedDaysExcludingCurrentMonth(year: number, month: number) {
  if (month <= 1) return 0

  let days = 0
  for (let calendarMonth = 1; calendarMonth < month; calendarMonth++) {
    days += daysInCalendarMonth(year, calendarMonth)
  }
  return days
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
  totalKm: number
  cpk: number
}

export type YtdAnalytics = {
  months: YtdAnalyticsPoint[]
  avgTotalUsd: number | null
  avgCpk: number | null
}

function average(values: number[]) {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

// A month is completed only after it has fully elapsed. The in-progress
// calendar month (and any future months) are excluded from MoM averages.
function isCompletedCalendarMonth(
  year: number,
  month: number,
  now: Date
) {
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  if (year < currentYear) return true
  if (year > currentYear) return false
  return month < currentMonth
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

async function querySpendByFitmentDate(
  fleetType: AnalyticsFleetType,
  dateFilter: SQL
) {
  const identityFilter = fleetTypeFilter(fleetType)

  return db
    .select({
      fitmentDate: mechanicalSparesTable.fitmentDate,
      totalUsd: sum(mechanicalSparesTable.costUsd),
    })
    .from(mechanicalSparesTable)
    .innerJoin(
      assetsTable,
      eq(mechanicalSparesTable.assetId, assetsTable.id)
    )
    .where(
      identityFilter ? and(dateFilter, identityFilter) : dateFilter
    )
    .groupBy(mechanicalSparesTable.fitmentDate)
}

async function querySpendTotal(
  fleetType: AnalyticsFleetType,
  dateFilter: SQL
) {
  const identityFilter = fleetTypeFilter(fleetType)

  const [row] = await db
    .select({
      totalUsd: sum(mechanicalSparesTable.costUsd),
    })
    .from(mechanicalSparesTable)
    .innerJoin(
      assetsTable,
      eq(mechanicalSparesTable.assetId, assetsTable.id)
    )
    .where(
      identityFilter ? and(dateFilter, identityFilter) : dateFilter
    )

  return toNumber(row?.totalUsd)
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

  revalidatePath("/analytics/financials")

  return row
}

// Year-to-date spend vs cost-per-km for Workshop Analytics. KM totals are
// fleet-wide (one `monthly_fleet_km` row per calendar month); USD is
// filtered to motive/towed when requested.
export async function getYtdAnalytics(
  year: number,
  fleetType: AnalyticsFleetType
): Promise<YtdAnalytics> {
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

  const months = MONTH_LABELS.map((month, index) => {
    const totalUsd = usdByMonth.get(index + 1) ?? 0
    const totalKm = kmByMonth.get(index + 1) ?? 0

    return {
      month,
      totalUsd,
      totalKm,
      cpk: totalKm > 0 ? totalUsd / totalKm : 0,
    }
  })

  const now = new Date()
  const completedMonths = months.filter((_, index) =>
    isCompletedCalendarMonth(data.year, index + 1, now)
  )

  return {
    months,
    avgTotalUsd: average(completedMonths.map((point) => point.totalUsd)),
    avgCpk: average(completedMonths.map((point) => point.cpk)),
  }
}

const getSpendPacingSchema = z.object({
  fleetType: z.enum(["combined", "motive", "towed"]),
})

export type DailyPacingPoint = {
  day: number
  actual: number
}

export type WeeklyPacingPoint = {
  week: number
  actual: number
}

export type SpendPacing = {
  dailyPacing: DailyPacingPoint[]
  weeklyPacing: WeeklyPacingPoint[]
  historicalDailyAvg: number
  historicalWeeklyAvg: number
}

function spendByIsoDate(
  rows: { fitmentDate: string; totalUsd: string | number | null }[]
) {
  const totals = new Map<string, number>()
  for (const row of rows) {
    totals.set(row.fitmentDate, toNumber(row.totalUsd))
  }
  return totals
}

// Current-month spend vs a single YTD run-rate. Historical daily/weekly
// averages are total year-to-date spend (strictly excluding the in-progress
// calendar month) divided by elapsed YTD days and weeks. Week 1 is days
// 1–7, week 2 is 8–14, and so on.
export async function getSpendPacing(
  fleetType: AnalyticsFleetType
): Promise<SpendPacing> {
  await requireWorkshopAnalyticsAccess()

  const data = getSpendPacingSchema.parse({ fleetType })
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const daysInCurrentMonth = daysInCalendarMonth(year, month)
  const yearStart = toIsoDate(year, 1, 1)
  const currentMonthStart = toFirstOfMonthIso(year, month)
  const currentMonthEnd = toIsoDate(year, month, daysInCurrentMonth)
  const ytdBeforeCurrentMonth = and(
    gte(mechanicalSparesTable.fitmentDate, yearStart),
    lt(mechanicalSparesTable.fitmentDate, currentMonthStart)
  )

  if (!ytdBeforeCurrentMonth) {
    throw new Error("YTD date filter is required")
  }

  const elapsedDays = ytdElapsedDaysExcludingCurrentMonth(year, month)
  const elapsedWeeks = elapsedDays / 7

  const [totalYtdSpend, currentRows] = await Promise.all([
    querySpendTotal(data.fleetType, ytdBeforeCurrentMonth),
    querySpendByFitmentDate(
      data.fleetType,
      between(
        mechanicalSparesTable.fitmentDate,
        currentMonthStart,
        currentMonthEnd
      )
    ),
  ])

  const historicalDailyAvg =
    elapsedDays > 0 ? totalYtdSpend / elapsedDays : 0
  const historicalWeeklyAvg =
    elapsedWeeks > 0 ? totalYtdSpend / elapsedWeeks : 0

  const currentByDay = new Map<number, number>()
  for (const [isoDate, totalUsd] of spendByIsoDate(currentRows)) {
    currentByDay.set(Number(isoDate.slice(8, 10)), totalUsd)
  }

  const dailyPacing: DailyPacingPoint[] = Array.from(
    { length: daysInCurrentMonth },
    (_, index) => {
      const day = index + 1
      return {
        day,
        actual: currentByDay.get(day) ?? 0,
      }
    }
  )

  const weeksInCurrentMonth = weekOfMonth(daysInCurrentMonth)
  const weeklyPacing: WeeklyPacingPoint[] = Array.from(
    { length: weeksInCurrentMonth },
    (_, index) => {
      const week = index + 1
      const startDay = (week - 1) * 7 + 1
      const endDay = Math.min(week * 7, daysInCurrentMonth)
      let actual = 0
      for (let day = startDay; day <= endDay; day++) {
        actual += currentByDay.get(day) ?? 0
      }

      return {
        week,
        actual,
      }
    }
  )

  return {
    dailyPacing,
    weeklyPacing,
    historicalDailyAvg,
    historicalWeeklyAvg,
  }
}
