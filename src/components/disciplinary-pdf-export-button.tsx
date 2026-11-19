"use client"

import { useMemo, useState } from "react"
import { FileDownIcon } from "lucide-react"

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
import type { DisciplinaryCase } from "@/lib/disciplinary-cases"
import {
  filterCasesForReport,
  generateHrDisciplinaryPdfReport,
  HR_REPORT_SCOPE_LABELS,
  type HrReportScope,
} from "@/lib/disciplinary-pdf-report"

export function DisciplinaryPdfExportButton({
  cases,
}: {
  cases: DisciplinaryCase[]
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<HrReportScope>("PENDING")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [generating, setGenerating] = useState(false)

  const matching = useMemo(
    () => filterCasesForReport(cases, scope, from, to),
    [cases, scope, from, to]
  )

  function handleDownload() {
    if (matching.length === 0) return
    setGenerating(true)
    try {
      generateHrDisciplinaryPdfReport(matching, {
        scopeLabel: HR_REPORT_SCOPE_LABELS[scope],
        fromDate: from || undefined,
        toDate: to || undefined,
      })
      toast.add({
        title: "HR report downloaded",
        description: `${matching.length} ${matching.length === 1 ? "case" : "cases"} exported to PDF.`,
        type: "success",
      })
      setOpen(false)
    } catch (error) {
      toast.add({
        title: "Could not generate PDF",
        description:
          error instanceof Error ? error.message : "Something went wrong.",
        type: "error",
      })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <FileDownIcon />
        Export HR Report (PDF)
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export HR Report (PDF)</DialogTitle>
          <DialogDescription>
            Choose which cases to include. The report is generated in your
            browser and downloaded as an A4 landscape PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pdf-scope">Scope</Label>
            <Select
              items={HR_REPORT_SCOPE_LABELS}
              value={scope}
              onValueChange={(value) => {
                if (value && value in HR_REPORT_SCOPE_LABELS) {
                  setScope(value as HrReportScope)
                }
              }}
            >
              <SelectTrigger id="pdf-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(HR_REPORT_SCOPE_LABELS).map(
                  ([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pdf-from">From (optional)</Label>
              <Input
                id="pdf-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(event) => setFrom(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pdf-to">To (optional)</Label>
              <Input
                id="pdf-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Dates filter on the case generated date.
          </p>

          <p className="text-sm font-medium" aria-live="polite">
            {matching.length} {matching.length === 1 ? "case" : "cases"} match
          </p>
        </div>

        <DialogFooter>
          <Button
            disabled={matching.length === 0 || generating}
            onClick={handleDownload}
          >
            <FileDownIcon />
            Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
