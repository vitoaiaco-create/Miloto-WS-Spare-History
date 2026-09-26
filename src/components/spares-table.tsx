"use client"

import { AlertTriangle, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { SparesHistoryRow } from "@/lib/spares-history"
import {
  formatStatementDate,
  formatStatementQty,
  formatStatementUsd,
  groupSparesByComponent,
  statementTotals,
} from "@/lib/spares-statement"

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

function formatUsdTotal(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

export function SparesTable({
  spares,
  isFiltered,
}: {
  spares: SparesHistoryRow[]
  isFiltered: boolean
}) {
  const totalPrice = spares.reduce(
    (acc, row) => acc + (Number(row.priceUsd) || 0),
    0
  )
  const totalAmount = spares.reduce(
    (acc, row) => acc + (Number(row.amountUsd) || 0),
    0
  )

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
      {spares.length > 0 ? (
        <TableFooter>
          <TableRow className="border-t-2 bg-muted/50 font-bold hover:bg-muted/50">
            <TableCell colSpan={6}>Total</TableCell>
            <TableCell>{formatUsdTotal(totalPrice)}</TableCell>
            <TableCell>{formatUsdTotal(totalAmount)}</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      ) : null}
    </Table>
  )
}

const STATEMENT_COLUMNS = 7

export function SparesStatementTable({
  spares,
  onRemove,
  emptyMessage = "No spare issues in this statement period.",
}: {
  spares: SparesHistoryRow[]
  onRemove: (id: number) => void
  emptyMessage?: string
}) {
  const groups = groupSparesByComponent(spares)
  const totals = statementTotals(spares)

  if (spares.length === 0) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Material Name</TableHead>
            <TableHead>Asset ID</TableHead>
            <TableHead>Part Number</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="w-10 print:hidden">
              <span className="sr-only">Remove</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell
              colSpan={STATEMENT_COLUMNS}
              className="text-center text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Material Name</TableHead>
          <TableHead>Asset ID</TableHead>
          <TableHead>Part Number</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="w-10 print:hidden">
            <span className="sr-only">Remove</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <StatementGroupRows
            key={group.name}
            group={group}
            onRemove={onRemove}
          />
        ))}
      </TableBody>
      <TableFooter>
        <TableRow className="border-t-2 bg-muted/50 font-bold hover:bg-muted/50">
          <TableCell colSpan={4}>Grand total</TableCell>
          <TableCell className="text-right">
            {formatStatementQty(totals.quantity)}
          </TableCell>
          <TableCell className="text-right">
            {formatStatementUsd(totals.amount)}
          </TableCell>
          <TableCell className="print:hidden" />
        </TableRow>
      </TableFooter>
    </Table>
  )
}

function StatementGroupRows({
  group,
  onRemove,
}: {
  group: ReturnType<typeof groupSparesByComponent>[number]
  onRemove: (id: number) => void
}) {
  return (
    <>
      <TableRow className="bg-zinc-900 hover:bg-zinc-900 dark:bg-zinc-100 dark:hover:bg-zinc-100">
        <TableCell
          colSpan={STATEMENT_COLUMNS}
          className="py-2.5 font-semibold tracking-wide text-zinc-50 uppercase dark:text-zinc-950"
        >
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <span>{group.name}</span>
            <span className="text-xs font-medium tracking-normal normal-case">
              {formatStatementQty(group.totalQuantity)} items ·{" "}
              {formatStatementUsd(group.totalAmount)}
            </span>
          </span>
        </TableCell>
      </TableRow>
      {group.rows.map((spare) => (
        <TableRow key={spare.id}>
          <TableCell>{formatStatementDate(spare.fitmentDate)}</TableCell>
          <TableCell className="whitespace-normal">{spare.materialName}</TableCell>
          <TableCell>{spare.identityNo}</TableCell>
          <TableCell>{spare.partNumber}</TableCell>
          <TableCell className="text-right">
            {formatStatementQty(spare.quantity)}
          </TableCell>
          <TableCell className="text-right">
            {formatStatementUsd(spare.amountUsd)}
          </TableCell>
          <TableCell className="print:hidden">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${spare.materialName} from statement`}
                    onClick={() => onRemove(spare.id)}
                  />
                }
              >
                <Trash2 />
              </TooltipTrigger>
              <TooltipContent>Remove from this statement</TooltipContent>
            </Tooltip>
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}
