import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  const spendByMonth = byMonth(data)
  const kmByMonth = byMonth(fleetKm)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Month-on-month figures</CardTitle>
        <CardDescription>
          Raw USD spend, fleet kilometres, and cost per km
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  )
}
