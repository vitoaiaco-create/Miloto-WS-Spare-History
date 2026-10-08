import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { getTireDamagesByAsset } from "@/actions/logistics"
import { LogisticsDashboard } from "@/components/logistics-dashboard"
import { getLatestCompletedMonth } from "@/lib/iso-date"
import {
  calculateMonthlyYield,
  calculateMotiveUnitYield,
  calculateOperatorYield,
} from "@/lib/logistics-scoring"

// This page reports on the most recently completed month, which changes
// every month. Force dynamic rendering so it's never served from a stale
// static/ISR cache (e.g. one generated back when August was still current).
export const dynamic = "force-dynamic"

export default async function LogisticsAnalyticsPage() {
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

  const [yieldData, motiveData, operatorData, tireDamages] = await Promise.all([
    calculateMonthlyYield(year, month),
    calculateMotiveUnitYield(year, month),
    calculateOperatorYield(year, month),
    getTireDamagesByAsset(year),
  ])

  return (
    <LogisticsDashboard
      data={yieldData}
      motiveData={motiveData}
      operatorData={operatorData}
      tireDamages={tireDamages}
      year={year}
      month={month}
    />
  )
}
