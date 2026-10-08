import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { getTireDamagesByAsset } from "@/actions/logistics"
import { LogisticsDashboard } from "@/components/logistics-dashboard"
import { parseAnalyticsPeriod } from "@/lib/analytics-period"
import { getDirectorSummaryMatrix } from "@/lib/director-summary-matrix-data"
import { getLatestCompletedMonth } from "@/lib/iso-date"
import {
  calculateMonthlyYield,
  calculateMotiveUnitYield,
  calculateOperatorYield,
} from "@/lib/logistics-scoring"

type SearchParams = { [key: string]: string | string[] | undefined }

// This page reports on the most recently completed month, which changes
// every month. Force dynamic rendering so it's never served from a stale
// static/ISR cache (e.g. one generated back when August was still current).
export const dynamic = "force-dynamic"

export default async function LogisticsAnalyticsPage({
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
  const hasLogisticsModule =
    sessionClaims?.metadata?.modules?.includes("logistics_analytics") ?? false

  if (role === "oils_only" || (!isAdmin && !hasLogisticsModule)) {
    redirect("/")
  }

  const { year, month } = getLatestCompletedMonth()
  const resolvedSearchParams = await searchParams
  const summaryPeriod = parseAnalyticsPeriod(resolvedSearchParams.period)

  const [yieldData, motiveData, operatorData, tireDamages, directorSummary] =
    await Promise.all([
      calculateMonthlyYield(year, month),
      calculateMotiveUnitYield(year, month),
      calculateOperatorYield(year, month),
      getTireDamagesByAsset(year),
      getDirectorSummaryMatrix(summaryPeriod.year, summaryPeriod.month),
    ])

  return (
    <LogisticsDashboard
      data={yieldData}
      motiveData={motiveData}
      operatorData={operatorData}
      tireDamages={tireDamages}
      directorSummary={directorSummary}
      year={year}
      month={month}
    />
  )
}
