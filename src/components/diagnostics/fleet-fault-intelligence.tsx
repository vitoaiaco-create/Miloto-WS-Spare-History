"use client"

import { format } from "date-fns"
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { SeverityBadge } from "@/components/diagnostics/diagnostics-badges"
import { PttExportDialogButton } from "@/components/diagnostics/ptt-export-dialog-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { PTT_SEVERITY_RANK } from "@/lib/ptt-diagnostics"
import {
  buildPttFaultReportRows,
  type PttFaultReportRow,
  type PttTruckSummaryRow,
} from "@/lib/ptt-diagnostics-report"
import type {
  PttApprovedExceptionRow,
  PttLedgerRow,
  PttSessionWithRelations,
  RecurringFault,
} from "@/lib/ptt-diagnostics-queries"
import { cn } from "@/lib/utils"

const SEVERITY_FILTER_ITEMS = {
  ALL: "All severities",
  CRITICAL: "Critical",
  CALIBRATION_ONLY: "Calibration Only",
  MONITOR: "Monitor",
  NEGLIGIBLE: "Negligible",
} as const

type SeverityFilter = keyof typeof SEVERITY_FILTER_ITEMS

type ViewMode = "groups" | "register"

// Register rows rendered at once; "Show more" adds another page.
const REGISTER_PAGE_SIZE = 100

type SortKey =
  | "faultCode"
  | "controlUnit"
  | "latestDate"
  | "severity"
  | "affected"
type SortState = { key: SortKey; direction: "asc" | "desc" } | null

function compareBy(key: SortKey, a: RecurringFault, b: RecurringFault) {
  switch (key) {
    case "faultCode":
      return a.faultCode.localeCompare(b.faultCode, "en", { numeric: true })
    case "controlUnit":
      return a.controlUnit.localeCompare(b.controlUnit, "en", {
        numeric: true,
      })
    case "latestDate":
      return a.latestScannedAt.getTime() - b.latestScannedAt.getTime()
    case "severity":
      return (
        PTT_SEVERITY_RANK[a.highestSeverity] -
        PTT_SEVERITY_RANK[b.highestSeverity]
      )
    case "affected":
      return a.affectedTruckCount - b.affectedTruckCount
  }
}

export function FleetFaultIntelligence({
  recurringFaults,
  sessions,
  ledger,
  exceptions,
  onOpenFleet,
}: {
  recurringFaults: RecurringFault[]
  sessions: readonly PttSessionWithRelations[]
  ledger: readonly PttLedgerRow[]
  exceptions: readonly PttApprovedExceptionRow[]
  onOpenFleet: (fleetId: string) => void
}) {
  const [view, setView] = useState<ViewMode>("groups")
  const [query, setQuery] = useState("")
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL")
  // `null` keeps the server order: affected trucks, then severity, then code.
  const [sort, setSort] = useState<SortState>(null)
  const [registerLimit, setRegisterLimit] = useState(REGISTER_PAGE_SIZE)

  function updateQuery(value: string) {
    setQuery(value)
    setRegisterLimit(REGISTER_PAGE_SIZE)
  }

  function updateSeverityFilter(value: SeverityFilter) {
    setSeverityFilter(value)
    setRegisterLimit(REGISTER_PAGE_SIZE)
  }

  const visibleFaults = useMemo(() => {
    const needle = query.trim().toUpperCase()

    const filtered = recurringFaults.filter((fault) => {
      if (
        severityFilter !== "ALL" &&
        fault.highestSeverity !== severityFilter
      ) {
        return false
      }
      if (!needle) return true
      return (
        fault.faultCode.includes(needle) ||
        fault.controlUnit.includes(needle) ||
        fault.componentDescription.toUpperCase().includes(needle) ||
        fault.sampleIntervention.toUpperCase().includes(needle) ||
        fault.affectedFleetIds.some((fleetId) => fleetId.includes(needle))
      )
    })

    if (!sort) return filtered
    const factor = sort.direction === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => factor * compareBy(sort.key, a, b))
  }, [recurringFaults, query, severityFilter, sort])

  // The register is built by the same function as the Excel / PDF exports,
  // on each truck's latest open scan, so the three always agree.
  const register = useMemo(
    () => buildPttFaultReportRows(sessions, { scope: "LATEST_OPEN" }),
    [sessions]
  )

  const summaryBySession = useMemo(() => {
    const map = new Map<number, PttTruckSummaryRow>()
    for (const row of register.truckSummaryRows) map.set(row.sessionId, row)
    return map
  }, [register])

  const visibleRegisterRows = useMemo(() => {
    const needle = query.trim().toUpperCase()
    return register.faultRows.filter((row) => {
      if (severityFilter !== "ALL" && row.aiSeverity !== severityFilter) {
        return false
      }
      if (!needle) return true
      return (
        row.fleetId.includes(needle) ||
        row.faultCode.toUpperCase().includes(needle) ||
        row.controlUnit.toUpperCase().includes(needle) ||
        row.pttDescription.toUpperCase().includes(needle) ||
        row.faultIntervention.toUpperCase().includes(needle) ||
        row.workshopDirectiveSummary.toUpperCase().includes(needle)
      )
    })
  }, [register, query, severityFilter])

  function toggleSort(key: SortKey) {
    // Cycles first direction -> opposite -> back to the default server order.
    // Numeric/severity/date columns start worst/newest-first.
    const first =
      key === "severity" || key === "affected" || key === "latestDate"
        ? "desc"
        : "asc"
    const opposite = first === "desc" ? "asc" : "desc"

    setSort((current) => {
      if (current?.key !== key) return { key, direction: first }
      if (current.direction === first) return { key, direction: opposite }
      return null
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <ToggleGroup
          variant="outline"
          value={[view]}
          onValueChange={(value) => {
            // Keep exactly one view selected (clicking the active one is a no-op).
            const next = value[0]
            if (next === "groups" || next === "register") setView(next)
          }}
          aria-label="Fault intelligence view"
        >
          <ToggleGroupItem value="groups">Recurring Fault Groups</ToggleGroupItem>
          <ToggleGroupItem value="register">
            Fault &amp; Intervention Register
          </ToggleGroupItem>
        </ToggleGroup>

        <InputGroup className="lg:max-w-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder={
              view === "groups"
                ? "Search fault code, ECU, description or intervention…"
                : "Search fleet no., code, ECU, description or intervention…"
            }
            aria-label={
              view === "groups"
                ? "Search fault code, ECU, description or intervention"
                : "Search fleet number, fault code, ECU, description or intervention"
            }
          />
        </InputGroup>

        <Select
          items={SEVERITY_FILTER_ITEMS}
          value={severityFilter}
          onValueChange={(value) => {
            if (value && value in SEVERITY_FILTER_ITEMS) {
              updateSeverityFilter(value as SeverityFilter)
            }
          }}
        >
          <SelectTrigger className="w-full lg:w-48" aria-label="Severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SEVERITY_FILTER_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <PttExportDialogButton
          sessions={sessions}
          ledger={ledger}
          exceptions={exceptions}
          className="lg:ml-auto"
        />
      </div>

      {view === "groups" ? (
        <RecurringGroupsView
          recurringFaults={recurringFaults}
          visibleFaults={visibleFaults}
          sort={sort}
          onSort={toggleSort}
          onOpenFleet={onOpenFleet}
        />
      ) : (
        <RegisterView
          totalRows={register.faultRows.length}
          totalTrucks={register.truckCount}
          rows={visibleRegisterRows}
          limit={registerLimit}
          onShowMore={() =>
            setRegisterLimit((current) => current + REGISTER_PAGE_SIZE)
          }
          summaryBySession={summaryBySession}
          onOpenFleet={onOpenFleet}
        />
      )}
    </div>
  )
}

function FleetBadge({
  fleetId,
  onOpenFleet,
}: {
  fleetId: string
  onOpenFleet: (fleetId: string) => void
}) {
  return (
    <Badge
      variant="outline"
      className="cursor-pointer font-mono hover:bg-muted"
      render={
        <button
          type="button"
          title={`View latest directive for ${fleetId}`}
          onClick={() => onOpenFleet(fleetId)}
        />
      }
    >
      {fleetId}
    </Badge>
  )
}

function CalibrationBadge() {
  return (
    <Badge
      variant="secondary"
      className="bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
    >
      Yes
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// View 1: recurring fault groups
// ---------------------------------------------------------------------------

function RecurringGroupsView({
  recurringFaults,
  visibleFaults,
  sort,
  onSort,
  onOpenFleet,
}: {
  recurringFaults: RecurringFault[]
  visibleFaults: RecurringFault[]
  sort: SortState
  onSort: (key: SortKey) => void
  onOpenFleet: (fleetId: string) => void
}) {
  if (recurringFaults.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No outstanding faults to analyse yet. Fleet-wide fault intelligence
        appears here once PTT scans have been logged.
      </div>
    )
  }

  return (
    <>
      {visibleFaults.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No recurring faults match the current search and filter.
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead
                  label="Fault Code"
                  sortKey="faultCode"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableHead
                  label="ECU"
                  sortKey="controlUnit"
                  sort={sort}
                  onSort={onSort}
                />
                <TableHead>Description</TableHead>
                <SortableHead
                  label="Latest Date"
                  sortKey="latestDate"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableHead
                  label="Severity"
                  sortKey="severity"
                  sort={sort}
                  onSort={onSort}
                />
                <TableHead>AI Intervention / Root Cause</TableHead>
                <TableHead>Cal. Req.</TableHead>
                <SortableHead
                  label="Affected Trucks"
                  sortKey="affected"
                  sort={sort}
                  onSort={onSort}
                />
                <TableHead>Trucks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleFaults.map((fault) => (
                <TableRow key={`${fault.faultCode}|${fault.controlUnit}`}>
                  <TableCell className="font-mono font-medium whitespace-nowrap">
                    {fault.faultCode}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {fault.controlUnit}
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                    {fault.componentDescription}
                  </TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap tabular-nums">
                    {format(fault.latestScannedAt, "yyyy-MM-dd")}
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={fault.highestSeverity} />
                  </TableCell>
                  <TableCell className="min-w-64 max-w-md whitespace-normal">
                    <p
                      className="line-clamp-4 text-sm"
                      title={fault.sampleIntervention}
                    >
                      {fault.sampleIntervention || (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </p>
                  </TableCell>
                  <TableCell>
                    {fault.calibrationRequired ? (
                      <CalibrationBadge />
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">
                    {fault.affectedTruckCount}
                  </TableCell>
                  <TableCell className="min-w-56 whitespace-normal">
                    <div className="flex flex-wrap gap-1">
                      {fault.affectedFleetIds.map((fleetId) => (
                        <FleetBadge
                          key={fleetId}
                          fleetId={fleetId}
                          onOpenFleet={onOpenFleet}
                        />
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Based on each truck&apos;s latest open scan. Showing{" "}
        {visibleFaults.length} of {recurringFaults.length} fault groups.
      </p>
    </>
  )
}

// ---------------------------------------------------------------------------
// View 2: fault & intervention register
// ---------------------------------------------------------------------------

function RegisterView({
  totalRows,
  totalTrucks,
  rows,
  limit,
  onShowMore,
  summaryBySession,
  onOpenFleet,
}: {
  totalRows: number
  totalTrucks: number
  rows: PttFaultReportRow[]
  limit: number
  onShowMore: () => void
  summaryBySession: ReadonlyMap<number, PttTruckSummaryRow>
  onOpenFleet: (fleetId: string) => void
}) {
  if (totalRows === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No outstanding faults to list yet. Every fault on each truck&apos;s
        latest open scan appears here with its AI intervention.
      </div>
    )
  }

  const shown = rows.slice(0, limit)

  return (
    <>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No faults match the current search and filter.
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Fleet No.</TableHead>
                <TableHead>Fault Code / ECU</TableHead>
                <TableHead>PTT Fault Description</TableHead>
                <TableHead>AI Severity</TableHead>
                <TableHead>AI Interventions Required</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row, index) => (
                <TableRow
                  key={`${row.sessionId}|${row.faultCode}|${row.controlUnit}|${index}`}
                  className="align-top"
                >
                  <TableCell className="font-mono text-xs whitespace-nowrap tabular-nums">
                    {row.scanDate}
                  </TableCell>
                  <TableCell>
                    <FleetBadge
                      fleetId={row.fleetId}
                      onOpenFleet={onOpenFleet}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="font-mono font-medium">{row.faultCode}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.controlUnit}
                    </div>
                    <div
                      className={cn(
                        "text-xs font-medium",
                        row.faultState === "ACTIVE"
                          ? "text-red-600 dark:text-red-400"
                          : "text-muted-foreground"
                      )}
                    >
                      {row.faultState}
                      {row.occurrenceCount != null &&
                        ` · ×${row.occurrenceCount}`}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                    {row.pttDescription}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <SeverityBadge severity={row.aiSeverity} />
                      {row.calibrationRequired && (
                        <Badge
                          variant="secondary"
                          className="bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                        >
                          Cal. req.
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="min-w-72 max-w-lg whitespace-normal">
                    <InterventionCell
                      rootCause={row.faultIntervention}
                      summary={summaryBySession.get(row.sessionId)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          Based on each truck&apos;s latest open scan. Showing{" "}
          {Math.min(limit, rows.length)} of {rows.length} matching fault rows
          ({totalRows} across {totalTrucks}{" "}
          {totalTrucks === 1 ? "truck" : "trucks"} in total).
        </p>
        {rows.length > limit && (
          <Button variant="outline" size="sm" onClick={onShowMore}>
            Show more
          </Button>
        )}
      </div>
    </>
  )
}

// The fault's own root cause, plus a truncated preview of the truck's
// Physical Checks that expands to the full checks and PTT navigation paths.
function InterventionCell({
  rootCause,
  summary,
}: {
  rootCause: string
  summary: PttTruckSummaryRow | undefined
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = Boolean(summary?.physicalInspections || summary?.pttPaths)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {rootCause || <span className="text-muted-foreground">—</span>}
      </p>

      {hasDetail && summary && (
        <div className="rounded-md bg-muted/50 p-2 text-xs">
          {summary.physicalInspections && (
            <div>
              <div className="font-medium">Physical Checks</div>
              <p
                className={cn(
                  "whitespace-pre-line text-muted-foreground",
                  !expanded && "line-clamp-2"
                )}
              >
                {summary.physicalInspections}
              </p>
            </div>
          )}
          {expanded && summary.pttPaths && (
            <div className="mt-2">
              <div className="font-medium">PTT Paths</div>
              <p className="whitespace-pre-line text-muted-foreground">
                {summary.pttPaths}
              </p>
            </div>
          )}
          <Button
            type="button"
            variant="link"
            size="xs"
            className="mt-1 h-auto px-0"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Show less" : "Show all checks & PTT paths"}
          </Button>
        </div>
      )}
    </div>
  )
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string
  sortKey: SortKey
  sort: SortState
  onSort: (key: SortKey) => void
}) {
  const active = sort?.key === sortKey
  const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown

  return (
    <TableHead
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2.5"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon
          data-icon="inline-end"
          className={active ? undefined : "opacity-40"}
        />
      </Button>
    </TableHead>
  )
}
