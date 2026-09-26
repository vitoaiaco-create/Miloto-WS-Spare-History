import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { LogisticsDashboard } from "@/components/logistics-dashboard"
import {
  calculateMonthlyYield,
  calculateMotiveUnitYield,
  calculateOperatorYield,
} from "@/lib/logistics-scoring"

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

  const [yieldData, motiveData, operatorData] = await Promise.all([
    calculateMonthlyYield(2026, 9),
    calculateMotiveUnitYield(2026, 8),
    calculateOperatorYield(2026, 8),
  ])

  return (
    <LogisticsDashboard
      data={yieldData}
      motiveData={motiveData}
      operatorData={operatorData}
      year={2026}
    />
  )
}
