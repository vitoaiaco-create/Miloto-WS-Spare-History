import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { getSpendPacing, getYtdAnalytics } from "@/actions/analytics"
import { AnalyticsDashboard } from "@/components/analytics-dashboard"

export default async function AnalyticsFinancialsPage() {
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

  const year = new Date().getFullYear()

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
    getSpendPacing("combined"),
    getSpendPacing("motive"),
    getSpendPacing("towed"),
  ])

  return (
    <AnalyticsDashboard
      combinedCpk={combinedCpk}
      motiveCpk={motiveCpk}
      towedCpk={towedCpk}
      combinedPacing={combinedPacing}
      motivePacing={motivePacing}
      towedPacing={towedPacing}
    />
  )
}
