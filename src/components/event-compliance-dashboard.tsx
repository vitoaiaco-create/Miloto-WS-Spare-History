"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { DownloadIcon, FileTextIcon } from "lucide-react"

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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import {
  COMPLIANCE_TAB_EXPORT_NAMES,
  COMPLIANCE_TAB_KEYS,
  COMPLIANCE_TAB_LABELS,
  exportToCSV,
  exportToPDF,
  partitionByAssetName,
  type ClassifiedComplianceRow,
  type ComplianceTabKey,
} from "@/lib/event-compliance-export"
import { formatIsoDate, parseIsoDate } from "@/lib/iso-date"
import { cn } from "@/lib/utils"
import {
  formatWorkshopDate,
  getComplianceStatus,
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
  const [activeTab, setActiveTab] = useState<ComplianceTabKey>("trucks")

  const date = useMemo(() => {
    const start = parseIsoDate(from)
    const end = parseIsoDate(to)
    return start && end ? { from: start, to: end } : undefined
  }, [from, to])

  const classified = useMemo<ClassifiedComplianceRow[]>(
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

  // Partition after the status filter so each tab only holds matching rows.
  const partitions = useMemo(
    () => partitionByAssetName(visibleRows),
    [visibleRows]
  )

  const activeData = partitions[activeTab]
  const activeTabName = COMPLIANCE_TAB_EXPORT_NAMES[activeTab]

  function hasExportableData() {
    if (activeData.length > 0) return true
    toast.add({
      title: "Nothing to export",
      description: `No ${activeTabName} match the current filter.`,
      type: "error",
    })
    return false
  }

  function handleExportCSV() {
    if (!hasExportableData()) return
    exportToCSV(activeData, activeTabName)
  }

  async function handleExportPDF() {
    if (!hasExportableData()) return
    try {
      await exportToPDF(activeData, activeTabName, { from, to, category })
    } catch {
      toast.add({
        title: "PDF export failed",
        description: "Could not generate the PDF. Please try again.",
        type: "error",
      })
    }
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

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleExportCSV}>
              <DownloadIcon data-icon="inline-start" />
              Export CSV
            </Button>
            <Button type="button" variant="outline" onClick={handleExportPDF}>
              <FileTextIcon data-icon="inline-start" />
              Export PDF
            </Button>
          </div>
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
          <Tabs
            defaultValue="trucks"
            className="w-full"
            onValueChange={(value) => {
              if ((COMPLIANCE_TAB_KEYS as readonly string[]).includes(value)) {
                setActiveTab(value as ComplianceTabKey)
              }
            }}
          >
            <TabsList>
              {COMPLIANCE_TAB_KEYS.map((key) => (
                <TabsTrigger key={key} value={key}>
                  {COMPLIANCE_TAB_LABELS[key]} ({partitions[key].length})
                </TabsTrigger>
              ))}
            </TabsList>
            {COMPLIANCE_TAB_KEYS.map((key) => (
              <TabsContent key={key} value={key}>
                <ComplianceTable rows={partitions[key]} />
              </TabsContent>
            ))}
          </Tabs>
          {partitions.other.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {partitions.other.length} unit
              {partitions.other.length === 1 ? "" : "s"} did not match any
              tab ({partitions.other.map((row) => row.assetName).join(", ")}).
            </p>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function ComplianceTable({ rows }: { rows: ClassifiedComplianceRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Asset Name</TableHead>
          <TableHead>Asset Type</TableHead>
          <TableHead>Last Event Date</TableHead>
          <TableHead>Last Event Outcome</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={5}
              className="h-24 text-center whitespace-normal text-muted-foreground"
            >
              No assets match the current filter.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.assetId}>
              <TableCell className="font-medium">{row.assetName}</TableCell>
              <TableCell>{row.assetType}</TableCell>
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
  )
}
