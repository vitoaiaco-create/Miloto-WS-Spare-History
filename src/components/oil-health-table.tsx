"use client"

import { useMemo, useState } from "react"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react"

import { requestOilSample } from "@/actions/ingestion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "@/components/ui/toast"
import {
  CRITICAL_BURN_RATE,
  oilComplianceStatusLabel,
  type OilComplianceEvent,
  type OilComplianceStatus,
  type OilHealthRow,
} from "@/lib/oil-status"

type SortColumn =
  | "assetName"
  | "status"
  | "lastEvent"
  | "overdueKilometers"
  | "totalTopUpLiters"
  | "burnRate"

type SortDirection = "asc" | "desc"

const STATUS_SORT_RANK: Record<OilComplianceStatus, number> = {
  overdue: 0,
  due_soon: 1,
  compliant: 2,
}

const NUMERIC_SORT_COLUMNS: SortColumn[] = [
  "overdueKilometers",
  "totalTopUpLiters",
  "burnRate",
]

function formatBurnRate(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString("en-US")
}

function statusVariant(status: OilComplianceStatus) {
  if (status === "overdue") return "destructive" as const
  if (status === "due_soon") return "outline" as const
  return "secondary" as const
}

function statusClassName(status: OilComplianceStatus) {
  if (status === "due_soon") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
  }
  if (status === "compliant") {
    return "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
  }
  return undefined
}

function lastEventLabel(lastEvent: OilComplianceEvent) {
  return lastEvent === "sample" ? "Sample" : "Service"
}

function needsSampleRequest(status: OilComplianceStatus | null) {
  return status === "overdue" || status === "due_soon"
}

function kmSinceComplianceTooltip(kmSinceCompliance: number | null) {
  if (kmSinceCompliance === null) return "No compliance mileage on file"

  return `${kmSinceCompliance.toLocaleString("en-US")} km since last compliance`
}

function compareRows(
  a: OilHealthRow,
  b: OilHealthRow,
  column: SortColumn,
  direction: SortDirection
) {
  const dir = direction === "asc" ? 1 : -1
  let result = 0

  switch (column) {
    case "assetName":
      result = a.assetName.localeCompare(b.assetName)
      break
    case "status": {
      const aRank = a.status ? STATUS_SORT_RANK[a.status] : 3
      const bRank = b.status ? STATUS_SORT_RANK[b.status] : 3
      result = aRank - bRank
      break
    }
    case "lastEvent":
      result = (a.lastEvent ?? "").localeCompare(b.lastEvent ?? "")
      break
    case "overdueKilometers":
      result = a.overdueKilometers - b.overdueKilometers
      break
    case "totalTopUpLiters":
      result = a.totalTopUpLiters - b.totalTopUpLiters
      break
    case "burnRate":
      result = (a.burnRate ?? -1) - (b.burnRate ?? -1)
      break
  }

  if (result === 0) return a.assetName.localeCompare(b.assetName)
  return result * dir
}

function SortableHead({
  label,
  column,
  sortColumn,
  sortDirection,
  onSort,
  className,
  align = "left",
}: {
  label: string
  column: SortColumn
  sortColumn: SortColumn
  sortDirection: SortDirection
  onSort: (column: SortColumn) => void
  className?: string
  align?: "left" | "right"
}) {
  const active = sortColumn === column
  const ariaSort = active
    ? sortDirection === "asc"
      ? "ascending"
      : "descending"
    : "none"

  return (
    <TableHead className={className} aria-sort={ariaSort}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={
          align === "right" ? "ml-auto -mr-2 h-7 px-2" : "-ml-2 h-7 px-2"
        }
        onClick={() => onSort(column)}
      >
        {label}
        {active ? (
          sortDirection === "desc" ? (
            <ArrowDownIcon data-icon="inline-end" />
          ) : (
            <ArrowUpIcon data-icon="inline-end" />
          )
        ) : (
          <ArrowUpDownIcon
            data-icon="inline-end"
            className="opacity-40"
          />
        )}
      </Button>
    </TableHead>
  )
}

function RequestSampleButton({ row }: { row: OilHealthRow }) {
  const [requested, setRequested] = useState(false)
  const [pending, setPending] = useState(false)

  if (!needsSampleRequest(row.status)) return null

  async function onRequestSample() {
    setPending(true)

    try {
      const result = await requestOilSample({ assetId: row.assetId })
      setRequested(true)

      toast.add({
        title: "Sample requested",
        description: `${result.fleetNumber} is now in the sampling pipeline.`,
        type: "success",
      })
    } catch (error) {
      toast.add({
        title: "Could not request sample",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while requesting the oil sample.",
        type: "error",
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      size="sm"
      variant={row.status === "overdue" ? "destructive" : "default"}
      disabled={pending || requested}
      onClick={onRequestSample}
    >
      {pending
        ? "Requesting…"
        : requested
          ? "Sample Requested"
          : "Request Sample"}
    </Button>
  )
}

function BurnRateCell({ burnRate }: { burnRate: number | null }) {
  if (burnRate === null) {
    return <span className="text-muted-foreground">—</span>
  }

  const display = formatBurnRate(burnRate)

  if (burnRate >= CRITICAL_BURN_RATE) {
    return (
      <Badge variant="destructive" className="font-bold tabular-nums">
        {display}
      </Badge>
    )
  }

  return <span className="tabular-nums">{display}</span>
}

export function OilHealthTable({ rows }: { rows: OilHealthRow[] }) {
  const [sortColumn, setSortColumn] = useState<SortColumn>("overdueKilometers")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => compareRows(a, b, sortColumn, sortDirection)),
    [rows, sortColumn, sortDirection]
  )

  function onSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"))
      return
    }

    setSortColumn(column)
    setSortDirection(NUMERIC_SORT_COLUMNS.includes(column) ? "desc" : "asc")
  }

  return (
    <div id="oils-priority-table">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              label="Asset ID"
              column="assetName"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={onSort}
            />
            <SortableHead
              label="Status"
              column="status"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={onSort}
            />
            <SortableHead
              label="Last Event"
              column="lastEvent"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={onSort}
            />
            <SortableHead
              label="Overdue KM"
              column="overdueKilometers"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={onSort}
              className="text-right"
              align="right"
            />
            <SortableHead
              label="Total Top-up (L)"
              column="totalTopUpLiters"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={onSort}
              className="text-right"
              align="right"
            />
            <SortableHead
              label="Burn Rate (L/1000km)"
              column="burnRate"
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={onSort}
              className="text-right"
              align="right"
            />
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center text-muted-foreground"
              >
                No active Miloto assets found.
              </TableCell>
            </TableRow>
          ) : (
            sortedRows.map((row) => (
              <TableRow key={row.assetId}>
                <TableCell>{row.assetName}</TableCell>
                <TableCell>
                  {row.status ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Badge
                            variant={statusVariant(row.status)}
                            className={statusClassName(row.status)}
                          />
                        }
                      >
                        {oilComplianceStatusLabel(row.status)}
                      </TooltipTrigger>
                      <TooltipContent>
                        {kmSinceComplianceTooltip(row.kmSinceCompliance)}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {row.lastEvent ? lastEventLabel(row.lastEvent) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatInteger(row.overdueKilometers)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatInteger(row.totalTopUpLiters)}
                </TableCell>
                <TableCell className="text-right">
                  <BurnRateCell burnRate={row.burnRate} />
                </TableCell>
                <TableCell className="text-right">
                  <RequestSampleButton row={row} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
