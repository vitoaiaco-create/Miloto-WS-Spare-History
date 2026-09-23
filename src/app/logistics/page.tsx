import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { LogisticsDashboard } from "@/components/logistics-dashboard"
import { calculateMonthlyYield } from "@/lib/logistics-scoring"

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

  const yieldData = await calculateMonthlyYield(2026, 9)

  return <LogisticsDashboard data={yieldData} />
}
