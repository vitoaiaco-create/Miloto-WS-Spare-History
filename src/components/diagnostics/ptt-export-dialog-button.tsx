"use client"

import {
  CheckIcon,
  FileDownIcon,
  FileSpreadsheetIcon,
  LoaderCircleIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import {
  PTT_FAULT_SEVERITIES,
  compareFleetIds,
  normalizeFleetId,
  type PttFaultSeverity,
} from "@/lib/ptt-diagnostics"
import {
  PTT_REPORT_SCOPE_LABELS,
  PTT_SEVERITY_FILTER_LABELS,
  type PttReportScope,
} from "@/lib/ptt-diagnostics-report"
import {
  buildPttReportData,
  type PttReportCase,
  type PttReportDataOptions,
  type PttReportExceptionRule,
  type PttReportKind,
  type PttReportLedgerRow,
} from "@/lib/ptt/report-data"
import { downloadPttReport } from "@/lib/ptt/report-download"
import { cn } from "@/lib/utils"

const SEVERITY_PILL_ACTIVE: Record<PttFaultSeverity, string> = {
  CRITICAL:
    "border-red-300 bg-red-100 text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300",
  CALIBRATION_ONLY:
    "border-purple-300 bg-purple-100 text-purple-800 hover:bg-purple-100 dark:border-purple-900 dark:bg-purple-950/60 dark:text-purple-300",
  MONITOR:
    "border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  NEGLIGIBLE:
    "border-zinc-300 bg-zinc-100 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
}

const ACTIONABLE_SEVERITIES: PttFaultSeverity[] = [
  "CRITICAL",
  "CALIBRATION_ONLY",
]

const DOWNLOAD_COPY: Record<
  PttReportKind,
  { label: string; success: string; failure: string }
> = {
  FAULT_PDF: {
    label: "Export Fault Report (PDF)",
    success: "Fault report downloaded",
    failure: "Could not generate the fault report",
  },
  EXECUTIVE_PDF: {
    label: "Export Executive Directives (PDF)",
    success: "Executive directives downloaded",
    failure: "Could not generate the executive directives",
  },
  EXCEL: {
    label: "Export Excel Workbook (.xlsx)",
    success: "Excel workbook downloaded",
    failure: "Could not generate the Excel workbook",
  },
}

export function PttExportDialogButton({
  sessions,
  ledger,
  exceptions,
  variant = "outline",
  size,
  className,
}: {
  sessions: readonly PttReportCase[]
  ledger: readonly PttReportLedgerRow[]
  exceptions: readonly PttReportExceptionRule[]
  variant?: "default" | "outline" | "secondary"
  size?: "default" | "sm"
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<PttReportScope>("LATEST_OPEN")
  const [severities, setSeverities] = useState<PttFaultSeverity[]>([
    ...PTT_FAULT_SEVERITIES,
  ])
  const [fleetId, setFleetId] = useState("ALL")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  // Checked by default: approved fleet exceptions are not workshop work.
  const [excludeApprovedExceptions, setExcludeApprovedExceptions] =
    useState(true)
  const [generating, setGenerating] = useState<PttReportKind | null>(null)

  // Every truck that has at least one scan, naturally sorted.
  const truckItems = useMemo(() => {
    const ids = new Set<string>()
    for (const session of sessions) ids.add(normalizeFleetId(session.fleetId))
    const items: Record<string, string> = { ALL: "All Trucks" }
    for (const id of [...ids].filter(Boolean).sort(compareFleetIds)) {
      items[id] = id
    }
    return items
  }, [sessions])

  // The selected truck can disappear (e.g. its only scan was deleted).
  const effectiveFleetId = fleetId in truckItems ? fleetId : "ALL"

  const options = useMemo<PttReportDataOptions>(
    () => ({
      scope,
      severities,
      fleetId: effectiveFleetId,
      fromDate: from || undefined,
      toDate: to || undefined,
      excludeApprovedExceptions,
    }),
    [scope, severities, effectiveFleetId, from, to, excludeApprovedExceptions]
  )

  const reportInput = useMemo(
    () => ({ sessions, ledger, exceptions }),
    [sessions, ledger, exceptions]
  )

  // The same data layer the PDFs and the workbook render, so the live
  // counter always matches what gets exported.
  const matching = useMemo(
    () => buildPttReportData(reportInput, options),
    [reportInput, options]
  )
  const rowCount = matching.faultRows.length
  const truckCount = matching.trucks.length

  const allSelected = severities.length === PTT_FAULT_SEVERITIES.length
  const actionableOnly =
    severities.length === ACTIONABLE_SEVERITIES.length &&
    ACTIONABLE_SEVERITIES.every((s) => severities.includes(s))

  function toggleSeverity(severity: PttFaultSeverity) {
    setSeverities((current) =>
      current.includes(severity)
        ? current.filter((s) => s !== severity)
        : [...current, severity]
    )
  }

  async function handleDownload(kind: PttReportKind) {
    if (truckCount === 0 || generating) return
    setGenerating(kind)
    try {
      // Let the spinner paint before the (synchronous) PDF build blocks.
      await new Promise((resolve) => setTimeout(resolve, 30))
      const result = await downloadPttReport(kind, reportInput, options)
      toast.add({
        title: DOWNLOAD_COPY[kind].success,
        description: `${result.trucks} ${result.trucks === 1 ? "truck" : "trucks"}, ${result.faultRows} fault ${result.faultRows === 1 ? "row" : "rows"} exported.`,
        type: "success",
      })
      setOpen(false)
    } catch (error) {
      toast.add({
        title: DOWNLOAD_COPY[kind].failure,
        description:
          error instanceof Error ? error.message : "Something went wrong.",
        type: "error",
      })
    } finally {
      setGenerating(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={variant} size={size} className={className} />}
      >
        <FileDownIcon />
        Export Report (Excel / PDF)
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Report (Excel / PDF)</DialogTitle>
          <DialogDescription>
            Choose which faults to include. Reports are generated in your
            browser: a technical Fault Report PDF, a standalone Executive
            Directives PDF (both A4 landscape) and a 3-tab Excel workbook.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ptt-export-scope">Scope</Label>
            <Select
              items={PTT_REPORT_SCOPE_LABELS}
              value={scope}
              onValueChange={(value) => {
                if (value && value in PTT_REPORT_SCOPE_LABELS) {
                  setScope(value as PttReportScope)
                }
              }}
            >
              <SelectTrigger id="ptt-export-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PTT_REPORT_SCOPE_LABELS).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Severity</Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant={actionableOnly ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setSeverities([...ACTIONABLE_SEVERITIES])}
                >
                  Critical &amp; Calibration Only
                </Button>
                <Button
                  type="button"
                  variant={allSelected ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setSeverities([...PTT_FAULT_SEVERITIES])}
                >
                  All
                </Button>
              </div>
            </div>
            <div
              role="group"
              aria-label="Severity"
              className="flex flex-wrap gap-1.5"
            >
              {PTT_FAULT_SEVERITIES.map((severity) => {
                const selected = severities.includes(severity)
                return (
                  <Button
                    key={severity}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={selected}
                    className={cn(
                      "rounded-full",
                      selected
                        ? SEVERITY_PILL_ACTIVE[severity]
                        : "text-muted-foreground"
                    )}
                    onClick={() => toggleSeverity(severity)}
                  >
                    {selected && <CheckIcon />}
                    {PTT_SEVERITY_FILTER_LABELS[severity]}
                  </Button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ptt-export-truck">Truck</Label>
            <Select
              items={truckItems}
              value={effectiveFleetId}
              onValueChange={(value) => {
                if (value && value in truckItems) setFleetId(value)
              }}
            >
              <SelectTrigger id="ptt-export-truck" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(truckItems).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ptt-export-from">From (optional)</Label>
              <Input
                id="ptt-export-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ptt-export-to">To (optional)</Label>
              <Input
                id="ptt-export-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Dates filter on each truck&apos;s latest scan date.
          </p>

          <div className="flex items-start gap-2">
            <Checkbox
              id="ptt-export-exclude-exceptions"
              checked={excludeApprovedExceptions}
              onCheckedChange={(checked) =>
                setExcludeApprovedExceptions(checked === true)
              }
            />
            <div className="grid gap-0.5">
              <Label htmlFor="ptt-export-exclude-exceptions">
                Exclude Approved Fleet Exceptions
              </Label>
              <p className="text-xs text-muted-foreground">
                Hides approved-exception rows from the Fault Report PDF and the
                Fault Register tab. Exception counts stay in the KPIs and are
                never listed as outstanding.
              </p>
            </div>
          </div>

          <p className="text-sm font-medium" aria-live="polite">
            {truckCount} {truckCount === 1 ? "truck" : "trucks"}, {rowCount}{" "}
            fault {rowCount === 1 ? "row" : "rows"} match
            {excludeApprovedExceptions && matching.excludedExceptionRows > 0 && (
              <span className="font-normal text-muted-foreground">
                {" "}
                (+{matching.excludedExceptionRows} approved{" "}
                {matching.excludedExceptionRows === 1 ? "exception" : "exceptions"}{" "}
                excluded)
              </span>
            )}
          </p>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-col sm:items-stretch">
          {(["FAULT_PDF", "EXECUTIVE_PDF", "EXCEL"] as const).map((kind) => (
            <Button
              key={kind}
              variant={kind === "FAULT_PDF" ? "default" : "outline"}
              className="w-full justify-start"
              disabled={truckCount === 0 || generating !== null}
              onClick={() => handleDownload(kind)}
            >
              {generating === kind ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : kind === "EXCEL" ? (
                <FileSpreadsheetIcon />
              ) : (
                <FileDownIcon />
              )}
              {DOWNLOAD_COPY[kind].label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
