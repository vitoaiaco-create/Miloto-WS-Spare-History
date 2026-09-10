"use client"

import { useState } from "react"
import {
  DownloadIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  Loader2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"
import type {
  SparesHistoryFilters,
  SparesHistoryRow,
} from "@/lib/spares-history"

// Converts the `YYYY-MM-DD` string returned for `date()` columns into the
// `DD-MM-YYYY` display format used throughout this table. Duplicated
// rather than shared, matching `share-table-button.tsx`'s export layout,
// since exports are deliberately independent of the on-screen table.
function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-")
  return `${day}-${month}-${year}`
}

function formatUsd(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`
}

function formatRunningKm(runningKm: number | null) {
  return runningKm === null ? "—" : runningKm.toLocaleString()
}

// These reports can land with people who have no Miloto account (and no
// way to see the filter bar), so — same as the Share image export — the
// active filters get baked into the document itself.
function describeFilters(filters: SparesHistoryFilters) {
  const parts: string[] = []
  if (filters.fleetNo) parts.push(`Fleet No: ${filters.fleetNo}`)
  if (filters.partNumber) parts.push(`Part Number: ${filters.partNumber}`)
  if (filters.materialName) parts.push(`Material: ${filters.materialName}`)
  if (filters.subEquipment)
    parts.push(`Sub Equipment: ${filters.subEquipment}`)
  if (filters.startDate || filters.endDate) {
    parts.push(
      `Date Range: ${filters.startDate ? formatDate(filters.startDate) : "…"} to ${
        filters.endDate ? formatDate(filters.endDate) : "…"
      }`
    )
  }
  return parts.join("   •   ")
}

const COLUMN_HEADERS = [
  "Outward Date",
  "Material Name",
  "Identity No",
  "Part Number",
  "Sub Equipment",
  "Quantity",
  "Price ($)",
  "Amount ($)",
  "Running KM",
]

// Quotes a CSV field only when it needs it (contains a comma, quote, or
// newline), doubling any internal quotes per RFC 4180.
function csvField(value: string | number | null) {
  const str = value === null ? "" : String(value)
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

// Kept as raw numbers (rather than `$`-formatted strings) so the CSV stays
// usable for spreadsheet math — unlike the PDF/image exports, which format
// for reading rather than recalculation.
function sparesToCsvRows(spares: SparesHistoryRow[]) {
  return spares.map((spare) => [
    formatDate(spare.fitmentDate),
    spare.materialName,
    spare.identityNo,
    spare.partNumber,
    spare.subEquipment,
    spare.quantity,
    spare.priceUsd,
    spare.amountUsd,
    spare.runningKm,
  ])
}

function sparesToPdfRows(spares: SparesHistoryRow[]) {
  return spares.map((spare) => [
    formatDate(spare.fitmentDate),
    spare.materialName,
    spare.identityNo,
    spare.partNumber,
    spare.subEquipment,
    String(spare.quantity),
    formatUsd(spare.priceUsd),
    formatUsd(spare.amountUsd),
    formatRunningKm(spare.runningKm),
  ])
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function exportFileName(extension: string) {
  return `spares-history-${new Date().toISOString().slice(0, 10)}.${extension}`
}

export function ExportTableMenu({
  spares,
  filters,
}: {
  spares: SparesHistoryRow[]
  filters: SparesHistoryFilters
}) {
  const [isExporting, setIsExporting] = useState<"csv" | "pdf" | null>(null)
  const disabled = spares.length === 0 || isExporting !== null

  function exportCsv() {
    setIsExporting("csv")
    try {
      const lines = [COLUMN_HEADERS, ...sparesToCsvRows(spares)].map((row) =>
        row.map(csvField).join(",")
      )
      // Leading BOM so Excel opens the file as UTF-8 rather than guessing
      // the system codepage and mangling any non-ASCII material names.
      const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
        type: "text/csv;charset=utf-8",
      })
      downloadBlob(blob, exportFileName("csv"))
    } catch (error) {
      toast.add({
        title: "Export failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while generating the CSV.",
        type: "error",
      })
    } finally {
      setIsExporting(null)
    }
  }

  async function exportPdf() {
    setIsExporting("pdf")

    try {
      // Loaded dynamically so these (fairly large) PDF-rendering libraries
      // only ship to the client when someone actually exports, rather than
      // bloating the initial page bundle.
      const { jsPDF } = await import("jspdf")
      const { default: autoTable } = await import("jspdf-autotable")

      const doc = new jsPDF({ orientation: "landscape" })
      const filterSummary = describeFilters(filters)

      doc.setFontSize(16)
      doc.text("Spares History", 14, 15)

      doc.setFontSize(9)
      doc.setTextColor(90)
      if (filterSummary) {
        doc.text(filterSummary, 14, 21)
      }
      doc.text(
        `Generated ${new Date().toLocaleString()} \u00b7 Miloto WS Spare History \u00b7 ${spares.length} row${
          spares.length === 1 ? "" : "s"
        }`,
        14,
        filterSummary ? 26 : 21
      )

      autoTable(doc, {
        startY: filterSummary ? 31 : 26,
        head: [COLUMN_HEADERS],
        body: sparesToPdfRows(spares),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [39, 39, 42] },
      })

      doc.save(exportFileName("pdf"))
    } catch (error) {
      toast.add({
        title: "Export failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while generating the PDF.",
        type: "error",
      })
    } finally {
      setIsExporting(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" disabled={disabled} />}
      >
        {isExporting ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          <DownloadIcon data-icon="inline-start" />
        )}
        Export
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={exportCsv} disabled={disabled}>
          <FileSpreadsheetIcon data-icon="inline-start" />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportPdf} disabled={disabled}>
          <FileTextIcon data-icon="inline-start" />
          Export as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
