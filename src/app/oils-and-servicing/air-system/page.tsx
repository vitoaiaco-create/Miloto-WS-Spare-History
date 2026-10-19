import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { getAirSystemCompliance } from "@/actions/air-system"
import {
  AirSystemPeriodSelect,
  PrintChecklistButton,
} from "@/components/air-system-controls"
import { AirSystemTable } from "@/components/air-system-table"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  analyticsPeriodLabel,
  formatAnalyticsPeriod,
  parseAnalyticsPeriod,
} from "@/lib/analytics-period"

type SearchParams = { [key: string]: string | string[] | undefined }

export default async function AirSystemPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const allowedModules = sessionClaims?.metadata?.modules || []
  const isOilsOnly = sessionClaims?.metadata?.role === "oils_only"

  if (!isOilsOnly && !allowedModules.includes("oils_servicing")) {
    redirect("/")
  }

  const resolvedSearchParams = await searchParams
  const period = parseAnalyticsPeriod(resolvedSearchParams.period)
  const periodValue = formatAnalyticsPeriod(period)
  const periodLabel = analyticsPeriodLabel(period)
  const rows = await getAirSystemCompliance(periodValue)

  const pendingCount = rows.filter((row) => row.status === "Pending").length
  const okCount = rows.filter((row) => row.status === "OK").length
  const failedCount = rows.filter((row) => row.status === "Failed").length
  const awaitingRepairCount = rows.filter(
    (row) => row.status === "Failed" && row.responseSpares.length === 0
  ).length

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body { background: white !important; color: black !important; }
        }
      `}</style>

      <div className="hidden print:mb-4 print:block print:text-black">
        <h1 className="text-xl font-semibold tracking-tight">
          Air System Testing Checklist
        </h1>
        <p className="mt-1 text-sm">{periodLabel}</p>
        <p className="mt-3 text-sm">
          Mechanic: ______________________ &nbsp;&nbsp; Date: ______________
        </p>
      </div>

      <div className="flex flex-col gap-4 print:hidden sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Air System Testing
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Monthly pass/fail tracker for horses and trailers. Failed tests
            list any Air System parts issued on or after the test date.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-medium">
            <span className="inline-flex h-5 items-center rounded-4xl bg-secondary px-2 text-secondary-foreground">
              {pendingCount} Pending
            </span>
            <span className="inline-flex h-5 items-center rounded-4xl bg-green-500/10 px-2 text-green-700 dark:text-green-400">
              {okCount} OK
            </span>
            <span className="inline-flex h-5 items-center rounded-4xl bg-destructive/10 px-2 text-destructive">
              {failedCount} Failed
            </span>
            {awaitingRepairCount > 0 ? (
              <span className="text-amber-700 dark:text-amber-400">
                {awaitingRepairCount} awaiting parts/repair
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <AirSystemPeriodSelect period={period} />
          <PrintChecklistButton />
        </div>
      </div>

      <Card className="print:overflow-visible print:rounded-none print:bg-white print:ring-0">
        <CardHeader className="print:hidden">
          <CardTitle>
            {periodLabel} roster
          </CardTitle>
        </CardHeader>
        <CardContent className="print:px-0">
          <AirSystemTable rows={rows} />
        </CardContent>
      </Card>
    </>
  )
}
