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
  const modules = sessionClaims?.metadata?.modules
  const hasWorkshopModule = modules?.includes("workshop_analytics") ?? false
  const hasLogisticsModule = modules?.includes("logistics_analytics") ?? false

  if (
    role === "oils_only" ||
    (!isAdmin && !hasWorkshopModule && !hasLogisticsModule)
  ) {
    redirect("/")
  }

  const yieldData = await calculateMonthlyYield(2026, 9)

  return <LogisticsDashboard data={yieldData} />
}
