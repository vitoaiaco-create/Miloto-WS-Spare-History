"use client"

import { useEffect, useState } from "react"
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
import {
  oilComplianceStatusLabel,
  type OilHealthRow,
} from "@/lib/oil-status"
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

function formatRunningKm(distance: number | null) {
  return distance === null ? "—" : distance.toLocaleString("en-US")
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString("en-US")
}

function formatOptionalKm(value: number | null) {
  return value === null ? "—" : formatInteger(value)
}

function formatBurnRate(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
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

type ExportColumn<T> = {
  header: string
  csv: (row: T) => string | number | null
  pdf: (row: T) => string
}

const SPARES_COLUMNS: ExportColumn<SparesHistoryRow>[] = [
  {
    header: "Outward Date",
    csv: (spare) => formatDate(spare.fitmentDate),
    pdf: (spare) => formatDate(spare.fitmentDate),
  },
  {
    header: "Material Name",
    csv: (spare) => spare.materialName,
    pdf: (spare) => spare.materialName,
  },
  {
    header: "Identity No",
    csv: (spare) => spare.identityNo,
    pdf: (spare) => spare.identityNo,
  },
  {
    header: "Part Number",
    csv: (spare) => spare.partNumber,
    pdf: (spare) => spare.partNumber,
  },
  {
    header: "Sub Equipment",
    csv: (spare) => spare.subEquipment,
    pdf: (spare) => spare.subEquipment,
  },
  {
    header: "Quantity",
    csv: (spare) => spare.quantity,
    pdf: (spare) => String(spare.quantity),
  },
  {
    header: "Price ($)",
    csv: (spare) => spare.priceUsd,
    pdf: (spare) => formatUsd(spare.priceUsd),
  },
  {
    header: "Amount ($)",
    csv: (spare) => spare.amountUsd,
    pdf: (spare) => formatUsd(spare.amountUsd),
  },
  {
    header: "Running KM",
    csv: (spare) => spare.distance,
    pdf: (spare) => formatRunningKm(spare.distance),
  },
]

const OIL_HEALTH_COLUMNS: ExportColumn<OilHealthRow>[] = [
  {
    header: "Asset ID",
    csv: (row) => row.assetName,
    pdf: (row) => row.assetName,
  },
  {
    header: "Status",
    csv: (row) => (row.status ? oilComplianceStatusLabel(row.status) : ""),
    pdf: (row) => (row.status ? oilComplianceStatusLabel(row.status) : "—"),
  },
  {
    header: "Current KM",
    csv: (row) => (row.currentKm === null ? null : Math.round(row.currentKm)),
    pdf: (row) => formatOptionalKm(row.currentKm),
  },
  {
    header: "Oil Running KM",
    csv: (row) =>
      row.oilRunningKm === null ? null : Math.round(row.oilRunningKm),
    pdf: (row) => formatOptionalKm(row.oilRunningKm),
  },
  {
    header: "Total Top-up (L)",
    csv: (row) => Math.round(row.totalTopUpLiters),
    pdf: (row) => formatInteger(row.totalTopUpLiters),
  },
  {
    header: "Burn Rate (L/1000km)",
    csv: (row) =>
      row.burnRate === null ? null : Number(row.burnRate.toFixed(2)),
    pdf: (row) => formatBurnRate(row.burnRate),
  },
  {
    header: "Overdue KM",
    csv: (row) => Math.round(row.overdueKilometers),
    pdf: (row) => formatInteger(row.overdueKilometers),
  },
]

// Quotes a CSV field only when it needs it (contains a comma, quote, or
// newline), doubling any internal quotes per RFC 4180.
function csvField(value: string | number | null) {
  const str = value === null ? "" : String(value)
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function isShareAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function isIOSLike() {
  const ua = navigator.userAgent
  if (/iPhone|iPod|iPad/i.test(ua)) return true
  // iPadOS 13+ spoofs Macintosh in the UA string.
  return navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua)
}

function prefersNativeShare() {
  return isIOSLike() || /Android/i.test(navigator.userAgent)
}

async function saveBlob(blob: Blob, fileName: string, mimeType: string) {
  const file = new File([blob], fileName, { type: mimeType })

  // Phones (especially iOS Safari) ignore programmatic `<a download>` clicks
  // for blob URLs. The native share sheet is the path that actually delivers
  // a file the user can save or send.
  try {
    if (
      prefersNativeShare() &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] })
    ) {
      await navigator.share({ files: [file], title: fileName })
      return
    }
  } catch (error) {
    if (isShareAbort(error)) throw error
  }

  const url = URL.createObjectURL(blob)

  // iOS still ignores `download` when Web Share isn't available; open the
  // blob as a document so the user can share/save it from Safari.
  if (isIOSLike()) {
    window.open(url, "_blank", "noopener")
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return
  }

  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking in the same tick cancels the download on some mobile browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function exportFileName(prefix: string, extension: string) {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.${extension}`
}

type PdfLibs = {
  jsPDF: typeof import("jspdf").jsPDF
  autoTable: typeof import("jspdf-autotable").default
}

// Cached across every Export menu on the page so opening one column on the
// pipeline preloads jsPDF for the others. iOS only allows share/download
// inside a user gesture — awaiting `import()` in the click handler itself
// would drop that gesture.
let pdfLibs: PdfLibs | null = null
let pdfLibsPromise: Promise<PdfLibs> | null = null

function preloadPdfLibs() {
  if (!pdfLibsPromise) {
    pdfLibsPromise = Promise.all([import("jspdf"), import("jspdf-autotable")]).then(
      ([jspdf, autotable]) => {
        pdfLibs = {
          jsPDF: jspdf.jsPDF,
          autoTable: autotable.default,
        }
        return pdfLibs
      }
    )
  }

  return pdfLibsPromise
}

function ExportMenu<T>({
  rows,
  columns,
  title,
  fileNamePrefix,
  description,
  compact = false,
}: {
  rows: T[]
  columns: ExportColumn<T>[]
  title: string
  fileNamePrefix: string
  description?: string
  compact?: boolean
}) {
  const [isExporting, setIsExporting] = useState<"csv" | "pdf" | null>(null)
  const [pdfReady, setPdfReady] = useState(() => pdfLibs !== null)
  const disabled = rows.length === 0 || isExporting !== null
  const headers = columns.map((column) => column.header)

  useEffect(() => {
    void preloadPdfLibs().then(() => setPdfReady(true))
  }, [])

  async function exportCsv() {
    setIsExporting("csv")
    try {
      const dataRows = rows.map((row) => columns.map((column) => column.csv(row)))
      const lines = [headers, ...dataRows].map((row) =>
        row.map(csvField).join(",")
      )
      // Leading BOM so Excel opens the file as UTF-8 rather than guessing
      // the system codepage and mangling any non-ASCII material names.
      const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
        type: "text/csv;charset=utf-8",
      })
      await saveBlob(
        blob,
        exportFileName(fileNamePrefix, "csv"),
        "text/csv"
      )
    } catch (error) {
      if (isShareAbort(error)) return

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
      const { jsPDF, autoTable } = pdfLibs ?? (await preloadPdfLibs())

      const doc = new jsPDF({ orientation: "landscape" })

      doc.setFontSize(16)
      doc.text(title, 14, 15)

      doc.setFontSize(9)
      doc.setTextColor(90)
      if (description) {
        doc.text(description, 14, 21)
      }
      doc.text(
        `Generated ${new Date().toLocaleString()} \u00b7 Miloto WS Spare History \u00b7 ${rows.length} row${
          rows.length === 1 ? "" : "s"
        }`,
        14,
        description ? 26 : 21
      )

      autoTable(doc, {
        startY: description ? 31 : 26,
        head: [headers],
        body: rows.map((row) => columns.map((column) => column.pdf(row))),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [39, 39, 42] },
      })

      await saveBlob(
        doc.output("blob"),
        exportFileName(fileNamePrefix, "pdf"),
        "application/pdf"
      )
    } catch (error) {
      if (isShareAbort(error)) return

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
        render={
          <Button
            type="button"
            variant={compact ? "ghost" : "outline"}
            size={compact ? "icon" : "default"}
            disabled={disabled}
            aria-label={compact ? `Export ${title}` : undefined}
          />
        }
      >
        {isExporting ? (
          <Loader2Icon
            data-icon={compact ? undefined : "inline-start"}
            className="animate-spin"
          />
        ) : (
          <DownloadIcon data-icon={compact ? undefined : "inline-start"} />
        )}
        {compact ? (
          <span className="sr-only">Export {title}</span>
        ) : (
          "Export"
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={exportCsv} disabled={disabled}>
          <FileSpreadsheetIcon data-icon="inline-start" />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportPdf} disabled={disabled || !pdfReady}>
          <FileTextIcon data-icon="inline-start" />
          {pdfReady ? "Export as PDF" : "Preparing PDF…"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ExportTableMenu({
  spares,
  filters,
}: {
  spares: SparesHistoryRow[]
  filters: SparesHistoryFilters
}) {
  return (
    <ExportMenu
      rows={spares}
      columns={SPARES_COLUMNS}
      title="Spares History"
      fileNamePrefix="spares-history"
      description={describeFilters(filters) || undefined}
    />
  )
}

export function ExportOilHealthMenu({
  rows,
  compact = false,
  title = "Oils & Servicing",
  fileNamePrefix = "oils-and-servicing",
}: {
  rows: OilHealthRow[]
  compact?: boolean
  title?: string
  fileNamePrefix?: string
}) {
  return (
    <ExportMenu
      rows={rows}
      columns={OIL_HEALTH_COLUMNS}
      title={title}
      fileNamePrefix={fileNamePrefix}
      compact={compact}
    />
  )
}

export type PipelineExportRow = {
  assetId: number
  assetName: string
  status: string
  createdAt: string
  currentKm: number | null
  oilRunningKm: number | null
}

const PIPELINE_STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  drawn: "Drawn",
  sent: "Sent to Lab",
  received: "Results Received",
}

function formatPipelineTimestamp(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString("en-GB")
}

function pipelineKmCsv(status: string, value: number | null) {
  return status === "requested" ? "-" : value || "-"
}

function pipelineKmPdf(status: string, value: number | null) {
  if (status === "requested") return "-"
  return value ? formatOptionalKm(value) : "-"
}

const PIPELINE_COLUMNS: ExportColumn<PipelineExportRow>[] = [
  {
    header: "Asset ID",
    csv: (row) => row.assetName,
    pdf: (row) => row.assetName,
  },
  {
    header: "Status",
    csv: (row) => PIPELINE_STATUS_LABEL[row.status] ?? row.status,
    pdf: (row) => PIPELINE_STATUS_LABEL[row.status] ?? row.status,
  },
  {
    header: "Current Mileage",
    csv: (row) => pipelineKmCsv(row.status, row.currentKm),
    pdf: (row) => pipelineKmPdf(row.status, row.currentKm),
  },
  {
    header: "Oil Running KM",
    csv: (row) => pipelineKmCsv(row.status, row.oilRunningKm),
    pdf: (row) => pipelineKmPdf(row.status, row.oilRunningKm),
  },
  {
    header: "Requested",
    csv: (row) => formatPipelineTimestamp(row.createdAt),
    pdf: (row) => formatPipelineTimestamp(row.createdAt),
  },
  {
    header: "Internal Asset ID",
    csv: (row) => row.assetId,
    pdf: (row) => String(row.assetId),
  },
]

export function ExportPipelineColumnMenu({
  rows,
  columnTitle,
}: {
  rows: PipelineExportRow[]
  columnTitle: string
}) {
  const slug = columnTitle.toLowerCase().replace(/\s+/g, "-")

  return (
    <ExportMenu
      rows={rows}
      columns={PIPELINE_COLUMNS}
      title={`Sampling pipeline — ${columnTitle}`}
      fileNamePrefix={`sampling-pipeline-${slug}`}
      compact
    />
  )
}
