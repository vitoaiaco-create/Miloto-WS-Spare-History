import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { getSpendPacing, getYtdAnalytics } from "@/actions/analytics"
import { AnalyticsDashboard } from "@/components/analytics-dashboard"
import { parseAnalyticsPeriod } from "@/lib/analytics-period"

type SearchParams = { [key: string]: string | string[] | undefined }

export default async function AnalyticsFinancialsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const role = sessionClaims?.metadata?.role
  const isAdmin = role === "admin"
  const hasAnalyticsModule =
    sessionClaims?.metadata?.modules?.includes("workshop_analytics") ?? false

  if (role === "oils_only" || (!isAdmin && !hasAnalyticsModule)) {
    redirect("/")
  }

  // The Monthly Spend chart (`getYtdAnalytics`) always covers the full
  // calendar year and is never scoped by the `period` selector below —
  // only the Daily/Weekly spend pacing charts (`getSpendPacing`) are.
  const year = new Date().getFullYear()
  const resolvedSearchParams = await searchParams
  const period = parseAnalyticsPeriod(resolvedSearchParams.period)

  const [
    combinedCpk,
    motiveCpk,
    towedCpk,
    combinedPacing,
    motivePacing,
    towedPacing,
  ] = await Promise.all([
    getYtdAnalytics(year, "combined"),
    getYtdAnalytics(year, "motive"),
    getYtdAnalytics(year, "towed"),
    getSpendPacing("combined", period),
    getSpendPacing("motive", period),
    getSpendPacing("towed", period),
  ])

  return (
    <AnalyticsDashboard
      period={period}
      combinedCpk={combinedCpk}
      motiveCpk={motiveCpk}
      towedCpk={towedCpk}
      combinedPacing={combinedPacing}
      motivePacing={motivePacing}
      towedPacing={towedPacing}
    />
  )
}
