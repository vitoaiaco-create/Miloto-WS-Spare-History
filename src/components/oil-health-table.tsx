"use client"

import { useMemo, useState } from "react"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react"

import { requestOilSample } from "@/actions/ingestion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  type OilComplianceStatus,
  type OilHealthRow,
} from "@/lib/oil-status"

type SortColumn =
  | "assetName"
  | "status"
  | "currentKm"
  | "oilRunningKm"
  | "totalTopUpLiters"
  | "burnRate"
  | "overdueKilometers"

type SortDirection = "asc" | "desc"

const STATUS_SORT_RANK: Record<OilComplianceStatus, number> = {
  overdue: 0,
  due_soon: 1,
  compliant: 2,
  unknown: 3,
}

const NUMERIC_SORT_COLUMNS: SortColumn[] = [
  "currentKm",
  "oilRunningKm",
  "totalTopUpLiters",
  "burnRate",
  "overdueKilometers",
]

function formatBurnRate(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
}

function formatInteger(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—"

  return Math.round(value).toLocaleString("en-US")
}

function formatOptionalKm(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—"

  return formatInteger(value)
}

function statusVariant(status: OilComplianceStatus) {
  if (status === "overdue") return "destructive" as const
  if (status === "due_soon" || status === "unknown") return "outline" as const
  return "secondary" as const
}

function statusClassName(status: OilComplianceStatus) {
  if (status === "due_soon") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
  }
  if (status === "compliant") {
    return "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
  }
  if (status === "unknown") {
    return "border-border bg-muted text-muted-foreground"
  }
  return undefined
}

function needsSampleRequest(row: OilHealthRow) {
  return (
    row.status === "overdue" ||
    row.status === "due_soon" ||
    row.status === "unknown"
  )
}

function kmSinceComplianceTooltip(row: OilHealthRow) {
  if (row.status === "unknown") {
    return "No ≥35 L oil replenishment on file. Request a sample to establish a baseline."
  }

  if (row.kmSinceCompliance === null) return "No compliance mileage on file"

  return `${row.kmSinceCompliance.toLocaleString("en-US")} km since last compliance`
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
    case "currentKm":
      result = (a.currentKm ?? -1) - (b.currentKm ?? -1)
      break
    case "oilRunningKm":
      result = (a.oilRunningKm ?? -1) - (b.oilRunningKm ?? -1)
      break
    case "totalTopUpLiters":
      result = a.totalTopUpLiters - b.totalTopUpLiters
      break
    case "burnRate":
      result = (a.burnRate ?? -1) - (b.burnRate ?? -1)
      break
    case "overdueKilometers":
      result = a.overdueKilometers - b.overdueKilometers
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
  const inPipeline = row.hasActiveSample || requested

  // Unknown / due / overdue trucks keep an action in this column. An
  // already-active pipeline card replaces Request Sample so workshop
  // staff cannot queue a duplicate.
  if (!needsSampleRequest(row) && !requested) return null

  if (inPipeline) {
    return (
      <Button size="sm" variant="outline" disabled>
        In Pipeline
      </Button>
    )
  }

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
      disabled={pending}
      onClick={onRequestSample}
    >
      {pending ? "Requesting…" : "Request Sample"}
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
  const [assetFilter, setAssetFilter] = useState("")
  const [sortColumn, setSortColumn] = useState<SortColumn>("overdueKilometers")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

  const filteredRoster = useMemo(
    () =>
      rows.filter((asset) =>
        asset.assetName.toLowerCase().includes(assetFilter.toLowerCase())
      ),
    [rows, assetFilter]
  )

  const sortedRows = useMemo(
    () =>
      [...filteredRoster].sort((a, b) =>
        compareRows(a, b, sortColumn, sortDirection)
      ),
    [filteredRoster, sortColumn, sortDirection]
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center">
        <Input
          placeholder="Filter Asset ID..."
          value={assetFilter}
          onChange={(event) => setAssetFilter(event.target.value)}
          className="max-w-sm"
        />
      </div>
      <div id="oils-priority-table">
        <Table containerClassName="relative w-full overflow-auto max-h-[650px]">
          <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]">
            <TableRow>
              <SortableHead
                label="Asset ID"
                column="assetName"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
                className="sticky top-0 left-0 z-30 bg-card border-r shadow-[2px_2px_5px_-2px_rgba(0,0,0,0.1)]"
              />
              <SortableHead
                label="Status"
                column="status"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
                className="sticky top-0 z-20 bg-card shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]"
              />
              <SortableHead
                label="Current KM"
                column="currentKm"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
                className="sticky top-0 z-20 bg-card text-right shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]"
                align="right"
              />
              <SortableHead
                label="Oil Running KM"
                column="oilRunningKm"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
                className="sticky top-0 z-20 bg-card text-right shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]"
                align="right"
              />
              <SortableHead
                label="Total Top-up (L)"
                column="totalTopUpLiters"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
                className="sticky top-0 z-20 bg-card text-right shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]"
                align="right"
              />
              <SortableHead
                label="Burn Rate (L/1000km)"
                column="burnRate"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
                className="sticky top-0 z-20 bg-card text-right shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]"
                align="right"
              />
              <SortableHead
                label="Overdue KM"
                column="overdueKilometers"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={onSort}
                className="sticky top-0 z-20 bg-card text-right shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]"
                align="right"
              />
              <TableHead className="sticky top-0 z-20 bg-card text-right shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground"
                >
                  {assetFilter
                    ? "No assets match this filter."
                    : "No active Miloto assets found."}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((row) => (
                <TableRow key={row.assetId}>
                  <TableCell className="sticky left-0 z-10 bg-card border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                    {row.assetName}
                  </TableCell>
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
                          {kmSinceComplianceTooltip(row)}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatOptionalKm(row.currentKm)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatOptionalKm(row.oilRunningKm)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatInteger(row.totalTopUpLiters)}
                  </TableCell>
                  <TableCell className="text-right">
                    <BurnRateCell burnRate={row.burnRate} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatInteger(row.overdueKilometers)}
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
    </div>
  )
}
