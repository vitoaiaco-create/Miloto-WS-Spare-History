import { AlertTriangle } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { SparesHistoryRow } from "@/lib/spares-history"

const STALE_ODOMETER_DAYS = 14
const MS_PER_DAY = 86_400_000

// Converts the `YYYY-MM-DD` string returned for `date()` columns into the
// `DD-MM-YYYY` display format used throughout this table.
function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-")
  return `${day}-${month}-${year}`
}

// Costs come from the outward report's "Price ($)" and "Amount ($)" columns,
// which the report leaves blank on some lines.
function formatUsd(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function isOdometerStale(latestDate: string) {
  const [year, month, day] = latestDate.split("-").map(Number)
  const latest = new Date(year, month - 1, day)
  const ageDays =
    (startOfLocalDay(new Date()).getTime() - latest.getTime()) / MS_PER_DAY
  return ageDays > STALE_ODOMETER_DAYS
}

function RunningKmCell({
  distance,
  latestDate,
}: {
  distance: number | null
  latestDate: string | null
}) {
  if (distance === null) return "—"

  const formatted = distance.toLocaleString("en-US")
  const stale = latestDate !== null && isOdometerStale(latestDate)

  if (!stale || latestDate === null) return formatted

  const warning = `Warning: Odometer hasn't updated since ${formatDate(latestDate)}`

  return (
    <span className="inline-flex items-center gap-1">
      {formatted}
      <span title={warning} className="inline-flex" aria-label={warning}>
        <AlertTriangle className="size-3.5 text-yellow-500" aria-hidden="true" />
      </span>
    </span>
  )
}

export function SparesTable({
  spares,
  isFiltered,
}: {
  spares: SparesHistoryRow[]
  isFiltered: boolean
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Outward Date</TableHead>
          <TableHead>Material Name</TableHead>
          <TableHead>Identity No</TableHead>
          <TableHead>Part Number</TableHead>
          <TableHead>Sub Equipment</TableHead>
          <TableHead>Quantity</TableHead>
          <TableHead>Price ($)</TableHead>
          <TableHead>Amount ($)</TableHead>
          <TableHead>Running KM</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {spares.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={9}
              className="text-center text-muted-foreground"
            >
              {isFiltered
                ? "No spares history matches the selected filters."
                : "Set a filter above to view spares history."}
            </TableCell>
          </TableRow>
        ) : (
          spares.map((spare) => (
            <TableRow key={spare.id}>
              <TableCell>{formatDate(spare.fitmentDate)}</TableCell>
              <TableCell>{spare.materialName}</TableCell>
              <TableCell>{spare.identityNo}</TableCell>
              <TableCell>{spare.partNumber}</TableCell>
              <TableCell>{spare.subEquipment}</TableCell>
              <TableCell>{spare.quantity}</TableCell>
              <TableCell>{formatUsd(spare.priceUsd)}</TableCell>
              <TableCell>{formatUsd(spare.amountUsd)}</TableCell>
              <TableCell>
                <RunningKmCell
                  distance={spare.distance}
                  latestDate={spare.latestDate}
                />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
