"use client"

import {
  CheckIcon,
  FileDownIcon,
  FileSpreadsheetIcon,
  LoaderCircleIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
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
  buildPttFaultReportRows,
  generatePttDiagnosticsExcel,
  generatePttDiagnosticsPdf,
  type PttReportScope,
  type PttReportSession,
} from "@/lib/ptt-diagnostics-report"
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

type Format = "excel" | "pdf"

export function PttExportDialogButton({
  sessions,
  variant = "outline",
  size,
  className,
}: {
  sessions: readonly PttReportSession[]
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
  const [generating, setGenerating] = useState<Format | null>(null)

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

  const options = useMemo(
    () => ({
      scope,
      severities,
      fleetId: effectiveFleetId,
      fromDate: from || undefined,
      toDate: to || undefined,
    }),
    [scope, severities, effectiveFleetId, from, to]
  )

  const matching = useMemo(
    () => buildPttFaultReportRows(sessions, options),
    [sessions, options]
  )
  const rowCount = matching.faultRows.length
  const truckCount = matching.truckCount

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

  async function handleDownload(kind: Format) {
    if (rowCount === 0 || generating) return
    setGenerating(kind)
    try {
      // Let the spinner paint before the (synchronous) PDF build blocks.
      await new Promise((resolve) => setTimeout(resolve, 30))
      if (kind === "excel") {
        await generatePttDiagnosticsExcel(sessions, options)
      } else {
        generatePttDiagnosticsPdf(sessions, options)
      }
      toast.add({
        title: kind === "excel" ? "Excel report downloaded" : "PDF report downloaded",
        description: `${rowCount} ${rowCount === 1 ? "fault row" : "fault rows"} across ${truckCount} ${truckCount === 1 ? "truck" : "trucks"} exported.`,
        type: "success",
      })
      setOpen(false)
    } catch (error) {
      toast.add({
        title:
          kind === "excel"
            ? "Could not generate Excel file"
            : "Could not generate PDF",
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
            Choose which faults to include. The report is generated in your
            browser: Excel as a two-sheet workbook, PDF as an A4 landscape
            handover document.
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
            Dates filter on the scan date.
          </p>

          <p className="text-sm font-medium" aria-live="polite">
            {rowCount} fault {rowCount === 1 ? "row" : "rows"} across{" "}
            {truckCount} {truckCount === 1 ? "truck" : "trucks"} match
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={rowCount === 0 || generating !== null}
            onClick={() => handleDownload("excel")}
          >
            {generating === "excel" ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <FileSpreadsheetIcon />
            )}
            Download Excel (.xlsx)
          </Button>
          <Button
            disabled={rowCount === 0 || generating !== null}
            onClick={() => handleDownload("pdf")}
          >
            {generating === "pdf" ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <FileDownIcon />
            )}
            Download PDF (.pdf)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
