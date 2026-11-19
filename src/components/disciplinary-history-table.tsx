"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  Loader2Icon,
  PaperclipIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { DeleteCaseDialog } from "@/components/disciplinary-delete-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import type { DisciplinaryCaseActions } from "@/hooks/use-disciplinary-case-actions"
import {
  formatCaseDateTime,
  HR_DISCIPLINARY_STATUSES,
  STATUS_SHORT_LABELS,
  type DisciplinaryCase,
  type HrDisciplinaryStatus,
} from "@/lib/disciplinary-cases"
import { cn } from "@/lib/utils"

type StatusFilter = "ALL" | HrDisciplinaryStatus

const STATUS_FILTER_ITEMS: Record<StatusFilter, string> = {
  ALL: "All",
  ...STATUS_SHORT_LABELS,
}

type SortKey =
  | "caseRef"
  | "driverName"
  | "employeeNo"
  | "fleetId"
  | "generatedAt"
  | "status"
  | "attachments"

type SortState = { key: SortKey; direction: "asc" | "desc" }

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" })

function compareCases(a: DisciplinaryCase, b: DisciplinaryCase, key: SortKey) {
  switch (key) {
    case "caseRef":
      return collator.compare(a.caseRef, b.caseRef)
    case "driverName":
      return collator.compare(a.driverName, b.driverName)
    case "employeeNo":
      return collator.compare(a.employeeNo, b.employeeNo)
    case "fleetId":
      return collator.compare(a.fleetId, b.fleetId)
    case "generatedAt":
      return a.generatedAt.getTime() - b.generatedAt.getTime()
    case "status":
      return (
        HR_DISCIPLINARY_STATUSES.indexOf(a.status) -
        HR_DISCIPLINARY_STATUSES.indexOf(b.status)
      )
    case "attachments":
      return a.attachments.length - b.attachments.length
  }
}

// `YYYY-MM-DD` from <input type="date"> -> local-time day boundaries.
function startOfDay(value: string) {
  return value ? new Date(`${value}T00:00:00`).getTime() : null
}

function endOfDay(value: string) {
  return value ? new Date(`${value}T23:59:59.999`).getTime() : null
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string
  sortKey: SortKey
  sort: SortState
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = sort.key === sortKey
  const Icon = !active
    ? ArrowUpDownIcon
    : sort.direction === "asc"
      ? ArrowUpIcon
      : ArrowDownIcon

  return (
    <TableHead
      className={className}
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2.5 h-7 px-2.5 font-medium"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <Icon className={cn(!active && "opacity-40")} />
      </Button>
    </TableHead>
  )
}

export function DisciplinaryHistoryTable({
  cases,
  actions,
  headerSlot,
  onOpenSignedDocs,
}: {
  cases: DisciplinaryCase[]
  actions: DisciplinaryCaseActions
  // Reserved for the "Export HR Report (PDF)" button.
  headerSlot?: ReactNode
  // Wired to the Signed Docs modal in the next step.
  onOpenSignedDocs?: (caseItem: DisciplinaryCase) => void
}) {
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [sort, setSort] = useState<SortState>({
    key: "generatedAt",
    direction: "desc",
  })
  const [deleteTarget, setDeleteTarget] = useState<DisciplinaryCase | null>(
    null
  )

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const fromMs = startOfDay(from)
    const toMs = endOfDay(to)

    const filtered = cases.filter((c) => {
      if (statusFilter !== "ALL" && c.status !== statusFilter) return false

      const generated = c.generatedAt.getTime()
      if (fromMs !== null && generated < fromMs) return false
      if (toMs !== null && generated > toMs) return false

      if (!query) return true
      return [c.caseRef, c.driverName, c.employeeNo, c.fleetId].some((value) =>
        value.toLowerCase().includes(query)
      )
    })

    const direction = sort.direction === "asc" ? 1 : -1
    return filtered.sort((a, b) => direction * compareCases(a, b, sort.key))
  }, [cases, search, statusFilter, from, to, sort])

  const hasFilters =
    search !== "" || statusFilter !== "ALL" || from !== "" || to !== ""

  function handleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : // Dates and counts are most useful newest/largest first.
          {
            key,
            direction:
              key === "generatedAt" || key === "attachments" ? "desc" : "asc",
          }
    )
  }

  function clearFilters() {
    setSearch("")
    setStatusFilter("ALL")
    setFrom("")
    setTo("")
  }

  const liveDeleteTarget = deleteTarget
    ? (cases.find((c) => c.id === deleteTarget.id) ?? null)
    : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Historical Log</h2>
          <p className="text-sm text-muted-foreground">
            Every logged case, including closed cases archived from the board.
          </p>
        </div>
        {/* Header slot: "Export HR Report (PDF)" lands here. */}
        <div className="flex items-center gap-2">{headerSlot}</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="history-search">Search</Label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="history-search"
              value={search}
              placeholder="Case Ref, offender, ID No or Fleet ID"
              className="pl-8"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="history-status">Status</Label>
          <Select
            items={STATUS_FILTER_ITEMS}
            value={statusFilter}
            onValueChange={(value) => {
              if (value && value in STATUS_FILTER_ITEMS) {
                setStatusFilter(value as StatusFilter)
              }
            }}
          >
            <SelectTrigger id="history-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_FILTER_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="history-from">From</Label>
          <Input
            id="history-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="history-to">To</Label>
          <Input
            id="history-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>

        <Button
          variant="ghost"
          disabled={!hasFilters}
          onClick={clearFilters}
          className="sm:col-span-2 lg:col-span-1"
        >
          <XIcon />
          Clear
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {rows.length} of {cases.length} case
        {cases.length === 1 ? "" : "s"}
      </p>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                label="Case Ref"
                sortKey="caseRef"
                sort={sort}
                onSort={handleSort}
              />
              <SortableHead
                label="Offender"
                sortKey="driverName"
                sort={sort}
                onSort={handleSort}
              />
              <SortableHead
                label="ID No"
                sortKey="employeeNo"
                sort={sort}
                onSort={handleSort}
              />
              <SortableHead
                label="Fleet ID"
                sortKey="fleetId"
                sort={sort}
                onSort={handleSort}
              />
              <SortableHead
                label="Generated Date"
                sortKey="generatedAt"
                sort={sort}
                onSort={handleSort}
              />
              <SortableHead
                label="Status"
                sortKey="status"
                sort={sort}
                onSort={handleSort}
              />
              <SortableHead
                label="Signed Docs"
                sortKey="attachments"
                sort={sort}
                onSort={handleSort}
              />
              <TableHead>Dispute Note</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="h-24 text-center text-muted-foreground"
                >
                  {cases.length === 0
                    ? "No cases have been logged yet."
                    : "No cases match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((caseItem) => {
                const pending = actions.isPending(caseItem.id)

                return (
                  <TableRow key={caseItem.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {caseItem.caseRef}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {caseItem.driverName || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {caseItem.employeeNo || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{caseItem.fleetId}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatCaseDateTime(caseItem.generatedAt)}
                    </TableCell>
                    <TableCell>
                      <Select
                        items={STATUS_SHORT_LABELS}
                        value={caseItem.status}
                        disabled={pending}
                        onValueChange={(value) => {
                          if (
                            value &&
                            (HR_DISCIPLINARY_STATUSES as readonly string[]).includes(
                              value
                            )
                          ) {
                            void actions.moveCase(
                              caseItem,
                              value as HrDisciplinaryStatus
                            )
                          }
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-40"
                          aria-label={`Status for ${caseItem.caseRef}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HR_DISCIPLINARY_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                              {STATUS_SHORT_LABELS[status]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        title="Signed documents"
                        render={
                          onOpenSignedDocs ? (
                            <button
                              type="button"
                              className="cursor-pointer hover:bg-muted"
                              onClick={() => onOpenSignedDocs(caseItem)}
                            />
                          ) : undefined
                        }
                      >
                        <PaperclipIcon />
                        {caseItem.attachments.length}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-64">
                      {caseItem.disputeNote ? (
                        <p
                          className="line-clamp-2 text-xs whitespace-normal text-muted-foreground"
                          title={caseItem.disputeNote}
                        >
                          {caseItem.disputeNote}
                        </p>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        {(
                          [
                            ["charge", "Charge"],
                            ["penalty", "Penalty"],
                          ] as const
                        ).map(([template, label]) => {
                          const downloading = actions.isDownloading(
                            caseItem.id,
                            template
                          )
                          return (
                            <Button
                              key={template}
                              variant="outline"
                              size="xs"
                              disabled={downloading}
                              title={`Re-download ${label} (.docx)`}
                              aria-label={`Re-download ${label} (.docx) for ${caseItem.caseRef}`}
                              onClick={() =>
                                void actions.downloadDocument(
                                  caseItem,
                                  template
                                )
                              }
                            >
                              {downloading ? (
                                <Loader2Icon className="animate-spin" />
                              ) : (
                                <DownloadIcon />
                              )}
                              {label}
                            </Button>
                          )
                        })}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={pending}
                          aria-label={`Delete ${caseItem.caseRef}`}
                          onClick={() => setDeleteTarget(caseItem)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {liveDeleteTarget && (
        <DeleteCaseDialog
          key={liveDeleteTarget.id}
          caseItem={liveDeleteTarget}
          onConfirm={actions.deleteCase}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
