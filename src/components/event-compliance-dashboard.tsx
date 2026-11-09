"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { DownloadIcon } from "lucide-react"

import { ComplianceStatusBadge } from "@/components/compliance-status-badge"
import { DatePickerWithRange } from "@/components/date-picker-with-range"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { toast } from "@/components/ui/toast"
import { exportDataToCSV } from "@/lib/export-image"
import { formatIsoDate, parseIsoDate } from "@/lib/iso-date"
import { cn } from "@/lib/utils"
import {
  formatWorkshopDate,
  getComplianceStatus,
  toWorkshopDay,
  WORKSHOP_EVENT_CATEGORIES,
  type ComplianceStatus,
  type FleetComplianceRow,
  type WorkshopEventCategory,
} from "@/lib/workshop-events"

const STATUS_FILTERS = ["All", "Pending", "OK", "Failed"] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

const FILTER_TO_STATUS: Record<
  Exclude<StatusFilter, "All">,
  ComplianceStatus
> = {
  Pending: "PENDING",
  OK: "OK",
  Failed: "FAILED",
}

// The window and category change what the server queries, so they live in the
// URL (`?from=&to=&category=`) and re-run the Server Component. The status
// filter only narrows the rows already loaded, so it is local state and
// applies instantly.
export function EventComplianceDashboard({
  rows,
  from,
  to,
  category,
}: {
  rows: FleetComplianceRow[]
  from: string
  to: string
  category: WorkshopEventCategory
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All")

  const date = useMemo(() => {
    const start = parseIsoDate(from)
    const end = parseIsoDate(to)
    return start && end ? { from: start, to: end } : undefined
  }, [from, to])

  const classified = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        status: getComplianceStatus(row.lastEventDate, row.lastEventOutcome),
      })),
    [rows]
  )

  const counts = useMemo(() => {
    const result: Record<ComplianceStatus, number> = {
      PENDING: 0,
      OK: 0,
      FAILED: 0,
    }
    for (const row of classified) result[row.status] += 1
    return result
  }, [classified])

  const visibleRows = useMemo(
    () =>
      statusFilter === "All"
        ? classified
        : classified.filter(
            (row) => row.status === FILTER_TO_STATUS[statusFilter]
          ),
    [classified, statusFilter]
  )

  function updateQuery(next: {
    from?: string
    to?: string
    category?: WorkshopEventCategory
  }) {
    const params = new URLSearchParams({
      from: next.from ?? from,
      to: next.to ?? to,
      category: next.category ?? category,
    })
    startTransition(() => {
      router.replace(`?${params.toString()}`, { scroll: false })
    })
  }

  function handleExport() {
    if (visibleRows.length === 0) {
      toast.add({
        title: "Nothing to export",
        description: "No assets match the current filter.",
        type: "error",
      })
      return
    }

    const slug = (value: string) => value.toLowerCase().replace(/\s+/g, "-")
    exportDataToCSV(
      visibleRows.map((row) => ({
        "Asset Name": row.assetName,
        "Last Event Date": row.lastEventDate
          ? toWorkshopDay(row.lastEventDate)
          : "",
        "Last Event Outcome": row.lastEventOutcome ?? "",
        Status: row.status,
      })),
      `event-compliance-${slug(category)}-${slug(statusFilter)}-${from}-to-${to}.csv`
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Control panel</CardTitle>
        </CardHeader>
        <CardContent
          className={cn(
            "grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] md:items-end",
            isPending && "opacity-70"
          )}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="event-compliance-range">Date range</Label>
            <DatePickerWithRange
              id="event-compliance-range"
              date={date}
              setDate={(next) => {
                if (!next) return
                updateQuery({
                  from: formatIsoDate(next.from),
                  to: formatIsoDate(next.to),
                })
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="event-compliance-category">Event category</Label>
            <Select
              value={category}
              onValueChange={(value) => {
                if (
                  value &&
                  (WORKSHOP_EVENT_CATEGORIES as readonly string[]).includes(
                    value
                  )
                ) {
                  updateQuery({ category: value as WorkshopEventCategory })
                }
              }}
            >
              <SelectTrigger id="event-compliance-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSHOP_EVENT_CATEGORIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="event-compliance-status">Status filter</Label>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                if (
                  value &&
                  (STATUS_FILTERS as readonly string[]).includes(value)
                ) {
                  setStatusFilter(value as StatusFilter)
                }
              }}
            >
              <SelectTrigger id="event-compliance-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button type="button" variant="outline" onClick={handleExport}>
            <DownloadIcon data-icon="inline-start" />
            Export CSV
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{category} compliance</CardTitle>
          <CardDescription>
            Showing {visibleRows.length} of {classified.length} units &middot;{" "}
            <span className="font-medium text-orange-600 dark:text-orange-400">
              {counts.PENDING} pending
            </span>{" "}
            &middot;{" "}
            <span className="font-medium text-red-600 dark:text-red-400">
              {counts.FAILED} failed
            </span>{" "}
            &middot;{" "}
            <span className="font-medium text-green-600 dark:text-green-400">
              {counts.OK} OK
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className={cn(isPending && "opacity-70")}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Asset Name</TableHead>
                <TableHead>Last Event Date</TableHead>
                <TableHead>Last Event Outcome</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={4}
                    className="h-24 text-center whitespace-normal text-muted-foreground"
                  >
                    No assets match the current filter.
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((row) => (
                  <TableRow key={row.assetId}>
                    <TableCell className="font-medium">
                      {row.assetName}
                    </TableCell>
                    <TableCell>
                      {row.lastEventDate
                        ? formatWorkshopDate(row.lastEventDate)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.lastEventOutcome ?? "—"}
                    </TableCell>
                    <TableCell>
                      <ComplianceStatusBadge status={row.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
