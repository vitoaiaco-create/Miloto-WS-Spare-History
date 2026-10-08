import { auth } from "@clerk/nextjs/server"
import Link from "next/link"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  formatAnalyticsPeriod,
  parseAnalyticsPeriod,
} from "@/lib/analytics-period"

type SearchParams = { [key: string]: string | string[] | undefined }

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
  const directorSummaryHref = `/spares-history?period=${formatAnalyticsPeriod(period)}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Operational Health</CardTitle>
        <CardDescription>
          The Director&apos;s Summary Matrix now lives under Spares History.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button nativeButton={false} render={<Link href={directorSummaryHref} />}>
          Open Director&apos;s Summary
        </Button>
      </CardContent>
    </Card>
  )
}
