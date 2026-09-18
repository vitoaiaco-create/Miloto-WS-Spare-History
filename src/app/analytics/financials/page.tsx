import { auth } from "@clerk/nextjs/server"
import { format } from "date-fns"
import { redirect } from "next/navigation"

import { getYtdAnalytics } from "@/actions/analytics"
import { AnalyticsDashboard } from "@/components/analytics-dashboard"

type SearchParams = { [key: string]: string | string[] | undefined }

function toSelectedMonth(value: string | string[] | undefined) {
  const raw = typeof value === "string" ? value : ""
  const match = /^(\d{4})-(\d{2})$/.exec(raw)
  if (!match) return format(new Date(), "yyyy-MM")

  const month = Number(match[2])
  if (month < 1 || month > 12) return format(new Date(), "yyyy-MM")

  return raw
}

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

  const selectedMonth = toSelectedMonth((await searchParams).month)
  const year = Number(selectedMonth.slice(0, 4))

  const [combinedCpk, motiveCpk, towedCpk] = await Promise.all([
    getYtdAnalytics(year, "combined"),
    getYtdAnalytics(year, "motive"),
    getYtdAnalytics(year, "towed"),
  ])

  return (
    <AnalyticsDashboard
      selectedMonth={selectedMonth}
      combinedCpk={combinedCpk}
      motiveCpk={motiveCpk}
      towedCpk={towedCpk}
    />
  )
}
