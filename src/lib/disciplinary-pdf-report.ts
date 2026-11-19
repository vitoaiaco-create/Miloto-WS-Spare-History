import { format } from "date-fns"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

import {
  ELAPSED_OVERDUE_MS,
  formatCaseDateTime,
  STATUS_LABELS,
  type DisciplinaryCase,
} from "@/lib/disciplinary-cases"

export type HrReportScope =
  | "PENDING"
  | "AWAITING_SIGNATURE"
  | "DISPUTED"
  | "CLOSED"
  | "ALL"

export const HR_REPORT_SCOPE_LABELS: Record<HrReportScope, string> = {
  PENDING: "Pending Only (Awaiting Signature + Disputed)",
  AWAITING_SIGNATURE: "Charge Awaiting Signature",
  DISPUTED: "Charge Disputed",
  CLOSED: "Charge Closed",
  ALL: "All Cases",
}

export type HrDisciplinaryPdfOptions = {
  scopeLabel: string
  // `YYYY-MM-DD` values from <input type="date">, filtering on `generatedAt`.
  fromDate?: string
  toDate?: string
}

const COMPANY = "MILOTO TRANSPORT LIMITED"
const TITLE = "HR Disciplinary Cases Report"

// `YYYY-MM-DD` -> local-time day boundaries.
function startOfDay(value?: string) {
  return value ? new Date(`${value}T00:00:00`).getTime() : null
}

function endOfDay(value?: string) {
  return value ? new Date(`${value}T23:59:59.999`).getTime() : null
}

// Single source of truth for which cases a scope + date range selects, so the
// live count in the dialog always matches the exported PDF.
export function filterCasesForReport(
  cases: DisciplinaryCase[],
  scope: HrReportScope,
  fromDate?: string,
  toDate?: string
) {
  const fromMs = startOfDay(fromDate)
  const toMs = endOfDay(toDate)

  return cases.filter((c) => {
    if (scope === "PENDING") {
      if (c.status !== "AWAITING_SIGNATURE" && c.status !== "DISPUTED") {
        return false
      }
    } else if (scope !== "ALL" && c.status !== scope) {
      return false
    }

    const generated = c.generatedAt.getTime()
    if (fromMs !== null && generated < fromMs) return false
    if (toMs !== null && generated > toMs) return false
    return true
  })
}

function sanitizeForFileName(value: string) {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function formatRange(fromDate?: string, toDate?: string) {
  const fmt = (value: string) => format(new Date(`${value}T00:00:00`), "dd MMM yyyy")
  if (fromDate && toDate) return `${fmt(fromDate)} to ${fmt(toDate)}`
  if (fromDate) return `From ${fmt(fromDate)}`
  if (toDate) return `Up to ${fmt(toDate)}`
  return null
}

export function generateHrDisciplinaryPdfReport(
  cases: DisciplinaryCase[],
  options: HrDisciplinaryPdfOptions
) {
  const { scopeLabel, fromDate, toDate } = options
  const generatedAt = new Date()
  const nowMs = generatedAt.getTime()

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 12

  // --- Header -------------------------------------------------------------
  doc.setFont("helvetica", "bold")
  doc.setFontSize(16)
  doc.setTextColor(20, 20, 20)
  doc.text(`${COMPANY} \u2014 ${TITLE}`, margin, 16)

  const range = formatRange(fromDate, toDate)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(90, 90, 90)
  doc.text(`Scope: ${scopeLabel}`, margin, 23)
  let subtitleY = 28
  if (range) {
    doc.text(`Date range (generated): ${range}`, margin, subtitleY)
    subtitleY += 5
  }
  doc.text(
    `Generated: ${format(generatedAt, "dd MMM yyyy, HH:mm:ss")}`,
    margin,
    subtitleY
  )

  // --- KPI summary bar ----------------------------------------------------
  const awaiting = cases.filter((c) => c.status === "AWAITING_SIGNATURE")
  const overdue = awaiting.filter(
    (c) => nowMs - c.generatedAt.getTime() > ELAPSED_OVERDUE_MS
  )
  const kpis: { label: string; value: number }[] = [
    { label: "Total Listed", value: cases.length },
    { label: "Awaiting Signature", value: awaiting.length },
    {
      label: "Disputed (HR)",
      value: cases.filter((c) => c.status === "DISPUTED").length,
    },
    {
      label: "Closed",
      value: cases.filter((c) => c.status === "CLOSED").length,
    },
    { label: "Overdue (>48h Awaiting Signature)", value: overdue.length },
  ]

  const barTop = subtitleY + 5
  const barHeight = 16
  const gap = 3
  const boxWidth = (pageWidth - margin * 2 - gap * (kpis.length - 1)) / kpis.length

  kpis.forEach((kpi, index) => {
    const x = margin + index * (boxWidth + gap)
    const isOverdue = index === kpis.length - 1 && kpi.value > 0
    doc.setDrawColor(isOverdue ? 220 : 200, isOverdue ? 60 : 200, isOverdue ? 60 : 200)
    doc.setFillColor(isOverdue ? 254 : 247, isOverdue ? 242 : 247, isOverdue ? 242 : 247)
    doc.roundedRect(x, barTop, boxWidth, barHeight, 1.5, 1.5, "FD")

    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.setTextColor(isOverdue ? 190 : 20, isOverdue ? 30 : 20, isOverdue ? 30 : 20)
    doc.text(String(kpi.value), x + 3, barTop + 8)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(90, 90, 90)
    doc.text(kpi.label, x + 3, barTop + 13)
  })

  // --- Table --------------------------------------------------------------
  const sorted = [...cases].sort(
    (a, b) => b.generatedAt.getTime() - a.generatedAt.getTime()
  )

  autoTable(doc, {
    startY: barTop + barHeight + 6,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [
      [
        "Case Ref",
        "Offender",
        "ID No",
        "Fleet ID",
        "Generated Date",
        "Status",
        "Signed Docs",
        "Notes",
      ],
    ],
    body: sorted.map((c) => [
      c.caseRef,
      c.driverName,
      c.employeeNo,
      c.fleetId,
      formatCaseDateTime(c.generatedAt),
      STATUS_LABELS[c.status],
      c.attachments.length === 0
        ? "None"
        : `${c.attachments.length} ${c.attachments.length === 1 ? "file" : "files"}`,
      c.disputeNote?.trim() ? c.disputeNote.trim() : "\u2014",
    ]),
    theme: "striped",
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 248, 250] },
    columnStyles: {
      0: { cellWidth: 34 },
      1: { cellWidth: 38 },
      2: { cellWidth: 24 },
      3: { cellWidth: 24 },
      4: { cellWidth: 36 },
      5: { cellWidth: 40 },
      6: { cellWidth: 22 },
      7: { cellWidth: "auto" },
    },
  })

  // --- Footer on every page -----------------------------------------------
  const totalPages = doc.getNumberOfPages()
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(120, 120, 120)
    doc.text(
      "Confidential \u2014 Miloto Transport Limited HR",
      margin,
      pageHeight - 7
    )
    doc.text(`Page ${page} of ${totalPages}`, pageWidth - margin, pageHeight - 7, {
      align: "right",
    })
  }

  const scopePart = sanitizeForFileName(scopeLabel) || "Report"
  doc.save(`Miloto_HR_Report_${scopePart}_${format(generatedAt, "yyyy-MM-dd")}.pdf`)
}
