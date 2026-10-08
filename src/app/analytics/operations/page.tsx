import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { DirectorSummaryMatrix } from "@/components/director-summary-matrix"
import { parseAnalyticsPeriod } from "@/lib/analytics-period"
import { getDirectorSummaryMatrix } from "@/lib/director-summary-matrix-data"

type SearchParams = { [key: string]: string | string[] | undefined }

export const dynamic = "force-dynamic"

export default async function AnalyticsOperationsPage({
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

  const resolvedSearchParams = await searchParams
  const period = parseAnalyticsPeriod(resolvedSearchParams.period)
  const matrix = await getDirectorSummaryMatrix(period.year, period.month)

  return <DirectorSummaryMatrix data={matrix} />
}
