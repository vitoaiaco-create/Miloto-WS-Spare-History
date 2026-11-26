"use client"

import { format } from "date-fns"
import { RepeatIcon, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { SeverityBadge } from "@/components/diagnostics/diagnostics-badges"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { compareFleetIds, normalizeFleetId } from "@/lib/ptt-diagnostics"
import type { PttLedgerRow } from "@/lib/ptt-diagnostics-queries"
import type { PttLedgerStatus } from "@/lib/ptt/constants"
import { ledgerDaysOpen } from "@/lib/ptt/ledger"
import { cn } from "@/lib/utils"

type StatusFilter = "ALL" | "ACTIVE" | PttLedgerStatus

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "ACTIVE", label: "Open & Reopened" },
  { value: "ALL", label: "All" },
  { value: "CLEARED", label: "Cleared" },
  { value: "APPROVED_EXCEPTION", label: "Exceptions" },
]

const STATUS_LABEL: Record<PttLedgerStatus, string> = {
  OPEN: "Open",
  CLEARED: "Cleared",
  REOPENED: "Reopened",
  APPROVED_EXCEPTION: "Approved Exception",
}

const STATUS_CLASS: Record<PttLedgerStatus, string> = {
  OPEN: "border-red-300 text-red-700 dark:border-red-800 dark:text-red-300",
  REOPENED:
    "border-orange-400 bg-orange-50 text-orange-800 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  CLEARED:
    "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300",
  APPROVED_EXCEPTION: "text-muted-foreground",
}

// Worst first within a truck.
const STATUS_ORDER: Record<PttLedgerStatus, number> = {
  REOPENED: 0,
  OPEN: 1,
  APPROVED_EXCEPTION: 2,
  CLEARED: 3,
}

function matchesFilter(status: PttLedgerStatus, filter: StatusFilter) {
  if (filter === "ALL") return true
  if (filter === "ACTIVE") return status === "OPEN" || status === "REOPENED"
  return status === filter
}

/**
 * The persistent per-truck fault ledger: every fault each truck has ever
 * shown, its lifecycle status, how long it has been open and how often it came
 * back after being cleared.
 */
export function TruckFaultLedger({
  ledger,
  onOpenFleet,
}: {
  ledger: PttLedgerRow[]
  onOpenFleet: (fleetId: string) => void
}) {
  const [filter, setFilter] = useState<StatusFilter>("ACTIVE")
  const [query, setQuery] = useState("")
  // Captured once per mount: "days open" doesn't need to tick live.
  const [now] = useState(() => new Date())

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return ledger
      .filter((entry) => matchesFilter(entry.ledgerStatus, filter))
      .filter(
        (entry) =>
          needle === "" ||
          entry.fleetId.toLowerCase().includes(needle) ||
          entry.canonicalKey.toLowerCase().includes(needle) ||
          entry.ecuLabel.toLowerCase().includes(needle) ||
          entry.description.toLowerCase().includes(needle)
      )
      .sort(
        (a, b) =>
          compareFleetIds(a.fleetId, b.fleetId) ||
          STATUS_ORDER[a.ledgerStatus] - STATUS_ORDER[b.ledgerStatus] ||
          a.canonicalKey.localeCompare(b.canonicalKey)
      )
  }, [ledger, filter, query])

  const trucks = useMemo(
    () => new Set(rows.map((entry) => entry.fleetId)).size,
    [rows]
  )
  const reopened = ledger.filter((entry) => entry.reopenCount > 0).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Truck Fault Ledger</CardTitle>
        <CardDescription>
          Every fault each truck has shown, tracked by exact fault key across
          scans.{" "}
          {reopened > 0
            ? `${reopened} fault${reopened === 1 ? " has" : "s have"} come back after being cleared.`
            : "No fault has come back after being cleared."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <ToggleGroup
            variant="outline"
            value={[filter]}
            onValueChange={(value) => {
              const next = STATUS_FILTERS.find((item) => item.value === value[0])
              if (next) setFilter(next.value)
            }}
            aria-label="Ledger status filter"
          >
            {STATUS_FILTERS.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <InputGroup className="lg:max-w-sm">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search truck, fault key, ECU or description…"
              aria-label="Search the truck fault ledger"
            />
          </InputGroup>
        </div>

        <p className="text-xs text-muted-foreground tabular-nums">
          {rows.length} fault{rows.length === 1 ? "" : "s"} across {trucks}{" "}
          truck{trucks === 1 ? "" : "s"}
        </p>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {ledger.length === 0
              ? "The ledger fills as trucks are scanned and verified."
              : "No ledger entries match the current filters."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Truck</TableHead>
                  <TableHead>Fault key</TableHead>
                  <TableHead>ECU / Description</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Re-opens</TableHead>
                  <TableHead>First seen</TableHead>
                  <TableHead>Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => onOpenFleet(normalizeFleetId(entry.fleetId))}
                        className="font-medium underline-offset-4 outline-none hover:underline focus-visible:underline"
                        title="Open the latest scan"
                      >
                        {entry.fleetId}
                      </button>
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-xs break-all">
                        {entry.canonicalKey}
                      </code>
                    </TableCell>
                    <TableCell className="max-w-72 whitespace-normal">
                      <span className="font-medium">{entry.ecuLabel}</span>
                      {entry.description.trim() && (
                        <span className="text-muted-foreground">
                          {" — "}
                          {entry.description.trim()}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={entry.latestSeverity} />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_CLASS[entry.ledgerStatus]}
                      >
                        {STATUS_LABEL[entry.ledgerStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="text-right tabular-nums"
                      title={
                        entry.ledgerStatus === "CLEARED"
                          ? "Days it was open before it was cleared"
                          : "Days open (since first seen, or since it was last re-opened)"
                      }
                    >
                      {ledgerDaysOpen(entry, now)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        entry.reopenCount > 0 &&
                          "font-semibold text-orange-700 dark:text-orange-300"
                      )}
                    >
                      {entry.reopenCount > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <RepeatIcon className="size-3" />
                          {entry.reopenCount}
                        </span>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {format(entry.firstSeenAt, "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {entry.ledgerStatus === "CLEARED" && entry.clearedAt
                        ? `Cleared ${format(entry.clearedAt, "dd MMM yyyy")}`
                        : format(entry.lastSeenAt, "dd MMM yyyy")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
