"use client"

import { format } from "date-fns"
import {
  ArrowDownAZ,
  FileText,
  Layers,
  ScanLine,
  Search,
  Trash2Icon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { DeleteScanDialog } from "@/components/diagnostics/delete-scan-dialog"
import {
  FaultCountPills,
  GenerationBadge,
  SeverityBadge,
  WorkflowStatusBadge,
} from "@/components/diagnostics/diagnostics-badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  compareFleetIds,
  countSessionsByFleet,
  isOpenDirective,
  latestSessionByFleet,
} from "@/lib/ptt-diagnostics"
import type { PttSessionWithRelations } from "@/lib/ptt-diagnostics-queries"
import { isBlockedWithAfterPhoto } from "@/lib/ptt/workshop-kpis"

type FilterValue =
  | "all"
  | "not_scanned"
  | "critical"
  | "calibration"
  | "monitor"
  | "negligible"
  | "open"
  | "blocked_after"

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All Trucks" },
  { value: "not_scanned", label: "Not Yet Scanned" },
  { value: "critical", label: "Critical" },
  { value: "calibration", label: "Calibration Only" },
  { value: "monitor", label: "Monitor" },
  { value: "negligible", label: "Negligible / Clear" },
  { value: "open", label: "Open Directives" },
  { value: "blocked_after", label: "Blocked (Has After Photo)" },
]

type CoverageRow = {
  fleetId: string
  latest: PttSessionWithRelations | null
  scanCount: number
}

// Lower = shown first when sorting by severity.
function severityTier(row: CoverageRow): number {
  switch (row.latest?.overallSeverity) {
    case "CRITICAL":
      return 0
    case "CALIBRATION_ONLY":
      return 1
    case "MONITOR":
      return 2
    case "NEGLIGIBLE":
    case "CLEAR":
      return 3
    default:
      return 4
  }
}

function matchesFilter(row: CoverageRow, filter: FilterValue): boolean {
  const severity = row.latest?.overallSeverity
  switch (filter) {
    case "all":
      return true
    case "not_scanned":
      return row.latest === null
    case "critical":
      return severity === "CRITICAL"
    case "calibration":
      return severity === "CALIBRATION_ONLY"
    case "monitor":
      return severity === "MONITOR"
    case "negligible":
      return severity === "NEGLIGIBLE" || severity === "CLEAR"
    case "open":
      return row.latest !== null && isOpenDirective(row.latest)
    case "blocked_after":
      return (
        row.latest !== null &&
        isBlockedWithAfterPhoto({
          caseStatus: row.latest.caseStatus,
          hasVerificationScan: row.latest.verificationScans.length > 0,
        })
      )
  }
}

export function FleetCoverageView({
  rosterFleetIds,
  sessions,
  onViewDirective,
  onScanTruck,
  onSessionDeleted,
}: {
  rosterFleetIds: string[]
  sessions: PttSessionWithRelations[]
  onViewDirective: (session: PttSessionWithRelations) => void
  onScanTruck: (fleetId: string) => void
  /** Called after a truck's latest scan was deleted; the parent syncs state. */
  onSessionDeleted: (sessionId: number) => void
}) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<FilterValue>("all")
  const [sortByFleetId, setSortByFleetId] = useState(false)

  const rows = useMemo<CoverageRow[]>(() => {
    const latestByFleet = latestSessionByFleet(sessions)
    const counts = countSessionsByFleet(sessions)
    return rosterFleetIds.map((fleetId) => ({
      fleetId,
      latest: latestByFleet.get(fleetId) ?? null,
      scanCount: counts.get(fleetId) ?? 0,
    }))
  }, [rosterFleetIds, sessions])

  const filterCounts = useMemo(() => {
    const counts = {} as Record<FilterValue, number>
    for (const { value } of FILTERS) {
      counts[value] = rows.filter((row) => matchesFilter(row, value)).length
    }
    return counts
  }, [rows])

  const visibleRows = useMemo(() => {
    const needle = query.trim().toUpperCase()

    const filtered = rows.filter((row) => {
      if (!matchesFilter(row, filter)) return false
      if (!needle) return true
      if (row.fleetId.includes(needle)) return true
      return (
        row.latest?.faults.some((fault) =>
          fault.faultCode.toUpperCase().includes(needle)
        ) ?? false
      )
    })

    return filtered.sort((a, b) =>
      sortByFleetId
        ? compareFleetIds(a.fleetId, b.fleetId)
        : severityTier(a) - severityTier(b) ||
          compareFleetIds(a.fleetId, b.fleetId)
    )
  }, [rows, query, filter, sortByFleetId])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <InputGroup className="sm:max-w-sm">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Fleet ID or fault code…"
              aria-label="Search fleet ID or fault code"
            />
          </InputGroup>

          <Button
            variant="outline"
            size="sm"
            className="sm:ml-auto"
            aria-pressed={sortByFleetId}
            onClick={() => setSortByFleetId((value) => !value)}
          >
            {sortByFleetId ? (
              <ArrowDownAZ data-icon="inline-start" />
            ) : (
              <Layers data-icon="inline-start" />
            )}
            {sortByFleetId ? "Sorted: Fleet ID (A–Z)" : "Sorted: Severity first"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
          {FILTERS.map(({ value, label }) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "default" : "outline"}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
              <span className="tabular-nums opacity-70">
                {filterCounts[value]}
              </span>
            </Button>
          ))}
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {rows.length === 0
            ? "No MTL trucks found. Sync the assets list or scan a truck to get started."
            : "No trucks match the current search and filters."}
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {visibleRows.map((row) => (
            <CoverageRowItem
              key={row.fleetId}
              row={row}
              onViewDirective={onViewDirective}
              onScanTruck={onScanTruck}
              onSessionDeleted={onSessionDeleted}
            />
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Showing {visibleRows.length} of {rows.length} trucks
      </p>
    </div>
  )
}

function CoverageRowItem({
  row,
  onViewDirective,
  onScanTruck,
  onSessionDeleted,
}: {
  row: CoverageRow
  onViewDirective: (session: PttSessionWithRelations) => void
  onScanTruck: (fleetId: string) => void
  onSessionDeleted: (sessionId: number) => void
}) {
  const { fleetId, latest, scanCount } = row
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!latest) {
    return (
      <li className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="w-20 font-mono text-sm font-semibold">{fleetId}</span>
        <Badge variant="outline" className="text-muted-foreground">
          Not Scanned
        </Badge>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => onScanTruck(fleetId)}
        >
          <ScanLine data-icon="inline-start" />
          Scan Truck
        </Button>
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="w-20 font-mono text-sm font-semibold">{fleetId}</span>
      <GenerationBadge generation={latest.truckGeneration} />
      <SeverityBadge severity={latest.overallSeverity} />
      <FaultCountPills
        criticalCount={latest.criticalCount}
        calibrationCount={latest.calibrationCount}
        monitorCount={latest.monitorCount}
        negligibleCount={latest.negligibleCount}
      />
      <WorkflowStatusBadge status={latest.status} />
      <span className="text-xs text-muted-foreground">
        {format(latest.scannedAt, "dd MMM yyyy")}
        {scanCount > 1 && ` · ${scanCount} scans`}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onViewDirective(latest)}
        >
          <FileText data-icon="inline-start" />
          View Directive
        </Button>
        <Button size="sm" onClick={() => onScanTruck(fleetId)}>
          <ScanLine data-icon="inline-start" />
          New Scan
        </Button>
        <Button
          size="sm"
          variant="destructive"
          aria-label={`Delete latest ${fleetId} scan`}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
      </div>

      <DeleteScanDialog
        scan={confirmDelete ? latest : null}
        onOpenChange={setConfirmDelete}
        onDeleted={onSessionDeleted}
      />
    </li>
  )
}
