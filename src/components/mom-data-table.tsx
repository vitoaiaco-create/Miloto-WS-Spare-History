"use client"

import { useMemo, useRef } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ExportMenu } from "@/components/ui/export-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const MONTH_COLUMNS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

export type MomDataPoint = {
  month: string
  totalUsd: number
  cpk: number
}

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const kmFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
})

const cpkFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function byMonth<T extends { month: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.month, row]))
}

function formatOrDash(value: number | undefined, format: (n: number) => string) {
  if (value === undefined || !Number.isFinite(value)) return "—"
  return format(value)
}

export function MomDataTable({
  data,
  fleetKm,
}: {
  data: MomDataPoint[]
  fleetKm: { month: string; totalKm: number }[]
}) {
  const tableRef = useRef<HTMLDivElement>(null)
  const spendByMonth = byMonth(data)
  const kmByMonth = byMonth(fleetKm)
  const csvData = useMemo(() => {
    const spend = byMonth(data)
    const km = byMonth(fleetKm)
    return MONTH_COLUMNS.map((month) => ({
      month,
      totalUsd: spend.get(month)?.totalUsd ?? null,
      fleetKm: km.get(month)?.totalKm ?? null,
      cpk: spend.get(month)?.cpk ?? null,
    }))
  }, [data, fleetKm])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Month-on-month figures</CardTitle>
        <CardDescription>
          Raw USD spend, fleet kilometres, and cost per km
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative pt-10">
          <ExportMenu
            targetRef={tableRef}
            tableData={csvData}
            filename="financials-table"
            className="absolute top-2 right-2 z-40"
          />
          <div ref={tableRef}>
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 min-w-[9.5rem] bg-card">
                  Metric
                </TableHead>
                {MONTH_COLUMNS.map((month) => (
                  <TableHead
                    key={month}
                    className="min-w-[4.75rem] text-right font-medium"
                  >
                    {month}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="sticky left-0 z-10 bg-card font-medium">
                  Cost Year (USD)
                </TableCell>
                {MONTH_COLUMNS.map((month) => (
                  <TableCell
                    key={month}
                    className="text-right font-mono tabular-nums"
                  >
                    {formatOrDash(
                      spendByMonth.get(month)?.totalUsd,
                      (value) => usdFormat.format(value)
                    )}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="sticky left-0 z-10 bg-card font-medium">
                  Fleet KM
                </TableCell>
                {MONTH_COLUMNS.map((month) => (
                  <TableCell
                    key={month}
                    className="text-right font-mono tabular-nums"
                  >
                    {formatOrDash(
                      kmByMonth.get(month)?.totalKm,
                      (value) => kmFormat.format(value)
                    )}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="sticky left-0 z-10 bg-card font-medium">
                  CPK
                </TableCell>
                {MONTH_COLUMNS.map((month) => (
                  <TableCell
                    key={month}
                    className="text-right font-mono tabular-nums"
                  >
                    {formatOrDash(
                      spendByMonth.get(month)?.cpk,
                      (value) => cpkFormat.format(value)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
