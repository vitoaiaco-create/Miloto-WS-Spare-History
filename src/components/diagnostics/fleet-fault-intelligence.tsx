"use client"

import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { SeverityBadge } from "@/components/diagnostics/diagnostics-badges"
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
import { PTT_SEVERITY_RANK } from "@/lib/ptt-diagnostics"
import type { RecurringFault } from "@/lib/ptt-diagnostics-queries"

const SEVERITY_FILTER_ITEMS = {
  ALL: "All severities",
  CRITICAL: "Critical",
  CALIBRATION_ONLY: "Calibration Only",
  MONITOR: "Monitor",
  NEGLIGIBLE: "Negligible",
} as const

type SeverityFilter = keyof typeof SEVERITY_FILTER_ITEMS

type SortKey = "faultCode" | "controlUnit" | "severity" | "affected"
type SortState = { key: SortKey; direction: "asc" | "desc" } | null

function compareBy(key: SortKey, a: RecurringFault, b: RecurringFault) {
  switch (key) {
    case "faultCode":
      return a.faultCode.localeCompare(b.faultCode, "en", { numeric: true })
    case "controlUnit":
      return a.controlUnit.localeCompare(b.controlUnit, "en", {
        numeric: true,
      })
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
  onOpenFleet,
}: {
  recurringFaults: RecurringFault[]
  onOpenFleet: (fleetId: string) => void
}) {
  const [query, setQuery] = useState("")
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL")
  // `null` keeps the server order: affected trucks, then severity, then code.
  const [sort, setSort] = useState<SortState>(null)

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
        fault.componentDescription.toUpperCase().includes(needle)
      )
    })

    if (!sort) return filtered
    const factor = sort.direction === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => factor * compareBy(sort.key, a, b))
  }, [recurringFaults, query, severityFilter, sort])

  function toggleSort(key: SortKey) {
    // Cycles first direction -> opposite -> back to the default server order.
    // Numeric/severity columns start worst-first.
    const first = key === "severity" || key === "affected" ? "desc" : "asc"
    const opposite = first === "desc" ? "asc" : "desc"

    setSort((current) => {
      if (current?.key !== key) return { key, direction: first }
      if (current.direction === first) return { key, direction: opposite }
      return null
    })
  }

  if (recurringFaults.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No outstanding faults to analyse yet. Fleet-wide fault intelligence
        appears here once PTT scans have been logged.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <InputGroup className="sm:max-w-sm">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search fault code, ECU or description…"
            aria-label="Search fault code, ECU or description"
          />
        </InputGroup>

        <Select
          items={SEVERITY_FILTER_ITEMS}
          value={severityFilter}
          onValueChange={(value) => {
            if (value && value in SEVERITY_FILTER_ITEMS) {
              setSeverityFilter(value as SeverityFilter)
            }
          }}
        >
          <SelectTrigger className="w-full sm:w-48" aria-label="Severity">
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
      </div>

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
                  onSort={toggleSort}
                />
                <SortableHead
                  label="ECU"
                  sortKey="controlUnit"
                  sort={sort}
                  onSort={toggleSort}
                />
                <TableHead>Description</TableHead>
                <SortableHead
                  label="Severity"
                  sortKey="severity"
                  sort={sort}
                  onSort={toggleSort}
                />
                <TableHead>Cal. Req.</TableHead>
                <SortableHead
                  label="Affected Trucks"
                  sortKey="affected"
                  sort={sort}
                  onSort={toggleSort}
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
                  <TableCell>
                    <SeverityBadge severity={fault.highestSeverity} />
                  </TableCell>
                  <TableCell>
                    {fault.calibrationRequired ? (
                      <Badge
                        variant="secondary"
                        className="bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                      >
                        Yes
                      </Badge>
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
                        <Badge
                          key={fleetId}
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
