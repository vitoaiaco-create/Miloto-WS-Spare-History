import { format } from "date-fns"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

import {
  PTT_SEVERITY_DISPLAY,
  describePttReportFilters,
  formatFaultLine,
  formatOutstandingLine,
  formatStatusPill,
  pttReportFileName,
  type PttReportData,
  type PttReportFaultItem,
  type PttReportFaultStatus,
  type PttReportTruck,
} from "./report-data"
import type { PttOverallSeverity } from "../ptt-diagnostics"
import type { PttCaseStatus } from "./constants"

// The two standalone landscape PDFs of the Fleet Diagnostics (PTT Intel)
// exports, built with `jspdf` (+ `jspdf-autotable` for the row-by-row log).
// Both render the SAME `PttReportData` as the Excel workbook. The builders are
// pure (no DOM, no download): they return the PDF bytes; the browser download
// lives in `report-download.ts`.

export type PttPdfResult = {
  fileName: string
  /** Visible report title (also stored in the PDF document properties). */
  title: string
  buffer: ArrayBuffer
  pageCount: number
}

const COMPANY = "MILOTO TRANSPORT LIMITED"
const COMPANY_SITE = "ZAMBEZI PORTLAND CEMENT"
export const PTT_FAULT_REPORT_TITLE =
  "Fleet Diagnostics (PTT Intel) \u2014 Fault & Intervention Report"
export const PTT_EXECUTIVE_REPORT_TITLE = "Executive Truck Directives Summary"

export type Rgb = [number, number, number]

export const PAGE_MARGIN = 12
export const FOOTER_RESERVE = 16
export const PT_TO_MM = 0.3528

// jsPDF's built-in Helvetica only renders Latin-1 (+ a few Windows-1252
// punctuation marks). Map the arrows / comparison signs the AI likes to use,
// and drop anything else (emoji, symbols) instead of printing garbage.
export function pdfText(value: string): string {
  return value
    .replace(/[\u2192\u21d2]/g, "->")
    .replace(/\u2190/g, "<-")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/[\u2212]/g, "-")
    .replace(/[\u00a0\u2009\u202f]/g, " ")
    .replace(/[^\n\u0020-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g, "")
}

export const EMPTY_CELL = "\u2014"

const SEVERITY_PDF_FILL: Record<PttOverallSeverity, Rgb> = {
  CRITICAL: [254, 202, 202],
  CALIBRATION_ONLY: [233, 213, 255],
  MONITOR: [253, 230, 138],
  NEGLIGIBLE: [229, 231, 235],
  CLEAR: [209, 250, 229],
}

const SEVERITY_PDF_TEXT: Record<PttOverallSeverity, Rgb> = {
  CRITICAL: [153, 27, 27],
  CALIBRATION_ONLY: [107, 33, 168],
  MONITOR: [146, 64, 14],
  NEGLIGIBLE: [55, 65, 81],
  CLEAR: [6, 95, 70],
}

const STATUS_PDF_FILL: Record<PttReportFaultStatus, Rgb> = {
  CLEARED: [209, 250, 229],
  STILL_OPEN: [254, 243, 199],
  NEW_REGRESSION: [254, 202, 202],
  APPROVED_EXCEPTION: [226, 232, 240],
  INACTIVE: [243, 244, 246],
}

const STATUS_PDF_TEXT: Record<PttReportFaultStatus, Rgb> = {
  CLEARED: [6, 95, 70],
  STILL_OPEN: [146, 64, 14],
  NEW_REGRESSION: [153, 27, 27],
  APPROVED_EXCEPTION: [71, 85, 105],
  INACTIVE: [107, 114, 128],
}

// A repeat (bounce-back) is the loudest "still open" state.
const REPEAT_PDF_FILL: Rgb = [255, 228, 230]
const REPEAT_PDF_TEXT: Rgb = [159, 18, 57]

function statusColors(item: PttReportFaultItem): { fill: Rgb; text: Rgb } {
  if (item.status === "STILL_OPEN" && item.repeatCount >= 1) {
    return { fill: REPEAT_PDF_FILL, text: REPEAT_PDF_TEXT }
  }
  return { fill: STATUS_PDF_FILL[item.status], text: STATUS_PDF_TEXT[item.status] }
}

export function newDoc(title: string): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  doc.setProperties({
    title: title.replace(/\u2014/g, "-"),
    subject: "Fleet Diagnostics (PTT Intel)",
    author: "Miloto Transport Limited",
    creator: "Miloto Fleet Diagnostics",
  })
  return doc
}

function drawHeader(
  doc: jsPDF,
  data: PttReportData,
  title: string,
  extraLines: string[]
): number {
  return drawHeaderBlock(
    doc,
    title,
    [...describePttReportFilters(data.options), ...extraLines],
    data.generatedAt
  )
}

/** Company line, report title, subtitle lines and the generation timestamp. */
export function drawHeaderBlock(
  doc: jsPDF,
  title: string,
  subtitleLines: readonly string[],
  generatedAt: Date
): number {
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(90, 90, 90)
  doc.text(`${COMPANY_SITE}  /  ${COMPANY}`, PAGE_MARGIN, 11)

  doc.setFontSize(16)
  doc.setTextColor(20, 20, 20)
  doc.text(title, PAGE_MARGIN, 18)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(90, 90, 90)
  let y = 24
  for (const line of subtitleLines) {
    doc.text(pdfText(line), PAGE_MARGIN, y)
    y += 5
  }
  doc.text(
    `Generated: ${format(generatedAt, "dd MMM yyyy, HH:mm:ss")}`,
    PAGE_MARGIN,
    y
  )
  return y
}

export type Kpi = { label: string; value: string; fill?: Rgb; text?: Rgb }

const KPI_DEFAULT_FILL: Rgb = [247, 247, 247]
const KPI_DEFAULT_TEXT: Rgb = [20, 20, 20]

export function drawKpiStrip(doc: jsPDF, top: number, kpis: readonly Kpi[]): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const height = 16
  const gap = 3
  const width =
    (pageWidth - PAGE_MARGIN * 2 - gap * (kpis.length - 1)) / kpis.length

  kpis.forEach((kpi, index) => {
    const x = PAGE_MARGIN + index * (width + gap)
    doc.setDrawColor(200, 200, 200)
    doc.setFillColor(...(kpi.fill ?? KPI_DEFAULT_FILL))
    doc.roundedRect(x, top, width, height, 1.5, 1.5, "FD")

    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.setTextColor(...(kpi.text ?? KPI_DEFAULT_TEXT))
    doc.text(kpi.value, x + 3, top + 8)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(90, 90, 90)
    doc.text(kpi.label, x + 3, top + 13)
  })
  return top + height
}

export function drawFooters(doc: jsPDF, generatedAt: Date): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const total = doc.getNumberOfPages()
  for (let page = 1; page <= total; page++) {
    doc.setPage(page)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(120, 120, 120)
    doc.text(
      `Confidential \u2014 Miloto Transport Limited  |  Generated ${format(generatedAt, "dd MMM yyyy, HH:mm:ss")}`,
      PAGE_MARGIN,
      pageHeight - 7
    )
    doc.text(`Page ${page} of ${total}`, pageWidth - PAGE_MARGIN, pageHeight - 7, {
      align: "right",
    })
  }
}

export function highlightedKpi(
  label: string,
  count: number,
  tone: PttOverallSeverity | "GREEN"
): Kpi {
  const value = String(count)
  if (count <= 0) return { label, value }
  return tone === "GREEN"
    ? { label, value, fill: [209, 250, 229], text: [6, 95, 70] }
    : { label, value, fill: SEVERITY_PDF_FILL[tone], text: SEVERITY_PDF_TEXT[tone] }
}

// ---------------------------------------------------------------------------
// PDF 1 - Fault & Intervention Report (row-by-row technical audit log)
// ---------------------------------------------------------------------------

export function buildFaultReportPdf(data: PttReportData): PttPdfResult {
  const title = PTT_FAULT_REPORT_TITLE
  const doc = newDoc(title)
  const pageWidth = doc.internal.pageSize.getWidth()
  const { kpis, faultRows, options } = data

  const extra: string[] = []
  if (options.excludeApprovedExceptions && data.excludedExceptionRows > 0) {
    extra.push(
      `${data.excludedExceptionRows} approved exception ${data.excludedExceptionRows === 1 ? "row" : "rows"} excluded from this table.`
    )
  }
  const subtitleY = drawHeader(doc, data, title, extra)

  const barBottom = drawKpiStrip(doc, subtitleY + 5, [
    { label: "Trucks", value: String(kpis.trucksCount) },
    highlightedKpi("Actionable Critical", kpis.actionableCriticalCount, "CRITICAL"),
    highlightedKpi(
      "Calibration Only",
      kpis.calibrationOnlyCount,
      "CALIBRATION_ONLY"
    ),
    highlightedKpi("Verified Cleared", kpis.verifiedClearedCount, "GREEN"),
    highlightedKpi("New Regressions", kpis.newRegressionsCount, "CRITICAL"),
    {
      label: `Approved Exceptions (${options.excludeApprovedExceptions ? "Excluded" : "Shown"})`,
      value: String(kpis.approvedExceptionsCount),
    },
  ])

  const printable = pageWidth - PAGE_MARGIN * 2
  const fixed = [19, 17, 46, 52, 24, 30]
  const widths = [...fixed, printable - fixed.reduce((a, b) => a + b, 0)]
  const SEVERITY_COLUMN = 4
  const STATUS_COLUMN = 5

  autoTable(doc, {
    startY: barBottom + 6,
    margin: { top: 14, left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: FOOTER_RESERVE },
    tableWidth: printable,
    head: [
      [
        "Date",
        "Fleet No.",
        "Fault Code / ECU",
        "PTT Fault Description",
        "Severity",
        "Reconciliation Status",
        "Intervention Required",
      ],
    ],
    body:
      faultRows.length === 0
        ? [
            [
              {
                content:
                  "No fault rows match the selected filters.",
                colSpan: 7,
                styles: { halign: "center", fontStyle: "italic", textColor: 120 },
              },
            ],
          ]
        : faultRows.map((row) => [
            row.scanDate,
            row.fleetId,
            pdfText(
              [
                row.codeLabel,
                row.ecuLabel,
                `${row.faultState}${row.occurrenceCount != null ? ` (x${row.occurrenceCount})` : ""}${row.calibrationRequired ? " | Cal. req." : ""}`,
              ].join("\n")
            ),
            pdfText(row.description) || EMPTY_CELL,
            PTT_SEVERITY_DISPLAY[row.severity],
            formatStatusPill(row),
            pdfText(row.intervention) || EMPTY_CELL,
          ]),
    theme: "striped",
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2,
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 248, 250] },
    columnStyles: {
      0: { cellWidth: widths[0] },
      1: { cellWidth: widths[1], fontStyle: "bold" },
      2: { cellWidth: widths[2] },
      3: { cellWidth: widths[3] },
      4: { cellWidth: widths[4], halign: "center" },
      5: { cellWidth: widths[5], halign: "center" },
      6: { cellWidth: widths[6] },
    },
    showHead: "everyPage",
    rowPageBreak: "avoid",
    didParseCell: (hook) => {
      if (hook.section !== "body" || faultRows.length === 0) return
      const row = faultRows[hook.row.index]
      if (!row) return
      if (hook.column.index === SEVERITY_COLUMN) {
        hook.cell.styles.fillColor = SEVERITY_PDF_FILL[row.severity]
        hook.cell.styles.textColor = SEVERITY_PDF_TEXT[row.severity]
        hook.cell.styles.fontStyle = "bold"
      }
      if (hook.column.index === STATUS_COLUMN) {
        const colors = statusColors(row)
        hook.cell.styles.fillColor = colors.fill
        hook.cell.styles.textColor = colors.text
        hook.cell.styles.fontStyle = "bold"
      }
    },
    didDrawCell: (hook) => {
      // Pill outline around the reconciliation status text.
      if (
        hook.section !== "body" ||
        hook.column.index !== STATUS_COLUMN ||
        faultRows.length === 0
      ) {
        return
      }
      const row = faultRows[hook.row.index]
      if (!row) return
      const lines = Math.max(1, hook.cell.text.length)
      const lineHeight = 8 * PT_TO_MM * 1.15
      doc.setDrawColor(...statusColors(row).text)
      doc.setLineWidth(0.25)
      doc.roundedRect(
        hook.cell.x + 1.2,
        hook.cell.y + 1,
        hook.cell.width - 2.4,
        lines * lineHeight + 2,
        1.6,
        1.6,
        "S"
      )
    },
  })

  drawFooters(doc, data.generatedAt)
  return {
    fileName: pttReportFileName("FAULT_PDF", options.scope, data.generatedAt),
    title,
    buffer: doc.output("arraybuffer"),
    pageCount: doc.getNumberOfPages(),
  }
}

// ---------------------------------------------------------------------------
// PDF 2 - Executive Truck Directives Summary (consolidated 6-column table)
// ---------------------------------------------------------------------------
//
// Rows hold rich, mixed-style content (coloured badges, callout blocks,
// pinned regressions), so this table is laid out with a small purpose-built
// renderer on top of jsPDF: every cell is a list of styled lines, the row
// height is the tallest cell, rows never straddle a page when they fit on one,
// and a row taller than a page is split line-by-line. The header is repeated
// on every page.

type FontStyle = "normal" | "bold" | "italic" | "bolditalic"

export type RichLine = {
  text: string
  font: FontStyle
  /** Font size in pt. */
  size: number
  color: Rgb
  /** Hanging indent of the text (mm). */
  indent?: number
  /** Marker drawn at the left edge of the first line of a list item. */
  bullet?: string
  /** Background behind the line: full width, or hugging the text for badges. */
  bg?: Rgb
  badge?: boolean
  /** Left accent bar (callouts). */
  accent?: Rgb
  /** Horizontal text inset inside a background (mm). */
  inset?: number
  padTop?: number
  padBottom?: number
  /** Empty space above the line / its background (mm). */
  gapBefore?: number
}

// Column width ratios (% of the printable width, sums to 100).
export const EXECUTIVE_COLUMN_RATIOS = [11, 16, 19, 21, 16, 17] as const

const EXECUTIVE_HEADERS = [
  "Truck & Status",
  "Cleared Fault Codes",
  "Outstanding Fault Codes",
  "Diagnosis & Parts Warning",
  "Physical Checks",
  "PTT Paths & Verification",
]

export const CELL_PAD_X = 1.8
export const CELL_PAD_Y = 1.8
export const HEADER_HEIGHT = 7

const lineHeightOf = (size: number) => size * PT_TO_MM * 1.28

export function heightOfLine(line: RichLine): number {
  return (
    (line.gapBefore ?? 0) +
    (line.padTop ?? 0) +
    lineHeightOf(line.size) +
    (line.padBottom ?? 0)
  )
}

export function heightOfLines(lines: readonly RichLine[]): number {
  return lines.reduce((total, line) => total + heightOfLine(line), 0)
}

export const INK: Rgb = [30, 41, 59]
export const MUTED: Rgb = [100, 116, 139]
export const GREEN_DARK: Rgb = [20, 83, 45]
export const RED_DARK: Rgb = [153, 27, 27]

const CASE_BADGE_FILL: Record<PttCaseStatus, Rgb> = {
  VERIFIED_CLOSED: [22, 163, 74],
  // Teal: closed by a manager release, visibly different from a clean closure.
  CLOSED_ACCEPTED_RESIDUALS: [13, 148, 136],
  PARTIAL_BLOCKED: [220, 38, 38],
  REJECTED_INCOMPLETE: [220, 38, 38],
  REJECTED_NO_PROGRESS: [185, 28, 28],
  OPEN: [217, 119, 6],
}

export type StyleSpec = Omit<RichLine, "text">

/** Wraps `text` to `width` mm in the style's font and returns one line per row. */
export function wrapLines(
  doc: jsPDF,
  text: string,
  style: StyleSpec,
  width: number
): RichLine[] {
  const inset = (style.inset ?? 0) * 2
  const indent = style.indent ?? 0
  doc.setFont("helvetica", style.font)
  doc.setFontSize(style.size)
  const wrapped: string[] = doc.splitTextToSize(
    pdfText(text),
    Math.max(8, width - inset - indent)
  )
  return wrapped.map((part, index) => ({
    ...style,
    text: part,
    bullet: index === 0 ? style.bullet : undefined,
    // Only the first line of a block keeps the gap above it.
    gapBefore: index === 0 ? style.gapBefore : 0,
    padTop: index === 0 ? style.padTop : 0,
    padBottom: index === wrapped.length - 1 ? style.padBottom : 0,
  }))
}

/** A coloured callout (label bar + body) with an accent bar. */
function callout(
  doc: jsPDF,
  label: string,
  body: string,
  width: number,
  colors: { labelBg: Rgb; labelText: Rgb; bodyBg: Rgb; bodyText: Rgb; accent: Rgb }
): RichLine[] {
  return [
    ...wrapLines(
      doc,
      label,
      {
        font: "bold",
        size: 6.3,
        color: colors.labelText,
        bg: colors.labelBg,
        accent: colors.accent,
        inset: 1.4,
        padTop: 0.7,
        gapBefore: 1.6,
      },
      width
    ),
    ...wrapLines(
      doc,
      body,
      {
        font: "normal",
        size: 6.8,
        color: colors.bodyText,
        bg: colors.bodyBg,
        accent: colors.accent,
        inset: 1.4,
        padBottom: 0.9,
      },
      width
    ),
  ]
}

function sectionLabel(doc: jsPDF, label: string, width: number): RichLine[] {
  return wrapLines(
    doc,
    label.toUpperCase(),
    { font: "bold", size: 6.2, color: MUTED, gapBefore: 1.4 },
    width
  )
}

function listLines(
  doc: jsPDF,
  items: readonly string[],
  width: number,
  numbered: boolean,
  style: Partial<StyleSpec> = {}
): RichLine[] {
  const lines: RichLine[] = []
  items.forEach((item, index) => {
    lines.push(
      ...wrapLines(
        doc,
        item,
        {
          font: "normal",
          size: 6.8,
          color: INK,
          indent: numbered ? 3.6 : 2.8,
          bullet: numbered ? `${index + 1}.` : "\u2022",
          gapBefore: index === 0 ? 0 : 0.7,
          ...style,
        },
        width
      )
    )
  })
  return lines
}

export function mutedLine(doc: jsPDF, text: string, width: number): RichLine[] {
  return wrapLines(
    doc,
    text,
    { font: "italic", size: 6.8, color: MUTED },
    width
  )
}

function truckCell(doc: jsPDF, truck: PttReportTruck, width: number): RichLine[] {
  const lines: RichLine[] = [
    ...wrapLines(
      doc,
      truck.fleetId,
      { font: "bold", size: 10.5, color: [20, 20, 20] },
      width
    ),
    ...wrapLines(
      doc,
      truck.generation,
      { font: "bold", size: 7.2, color: [71, 85, 105] },
      width
    ),
    ...wrapLines(
      doc,
      `Baseline: ${truck.baselineDate}`,
      { font: "normal", size: 6.4, color: MUTED, gapBefore: 0.6 },
      width
    ),
  ]
  if (truck.lastVerifiedDate) {
    lines.push(
      ...wrapLines(
        doc,
        `Verified: ${truck.lastVerifiedDate}`,
        { font: "normal", size: 6.4, color: MUTED },
        width
      )
    )
  }
  lines.push(
    ...wrapLines(
      doc,
      truck.caseStatusLabel,
      {
        font: "bold",
        size: 6.2,
        color: [255, 255, 255],
        bg: CASE_BADGE_FILL[truck.caseStatus],
        badge: true,
        inset: 1.3,
        padTop: 0.7,
        padBottom: 0.7,
        gapBefore: 1.6,
      },
      width
    ),
    ...wrapLines(
      doc,
      `Clr ${truck.clearedCount} | Open ${truck.outstandingCount} | Reg ${truck.newRegressionsCount} | Exc ${truck.approvedExceptionsCount}`,
      { font: "normal", size: 6, color: MUTED, gapBefore: 1.4 },
      width
    )
  )
  return lines
}

function clearedCell(doc: jsPDF, truck: PttReportTruck, width: number): RichLine[] {
  if (!truck.isVerified || truck.clearedItems.length === 0) {
    return mutedLine(doc, truck.clearedFaultCodes[0] ?? EMPTY_CELL, width)
  }
  return listLines(
    doc,
    truck.clearedItems.map(formatFaultLine),
    width,
    false,
    { color: GREEN_DARK }
  )
}

function outstandingCell(
  doc: jsPDF,
  truck: PttReportTruck,
  width: number
): RichLine[] {
  const lines: RichLine[] = []
  if (truck.outstandingItems.length === 0) {
    lines.push(
      ...wrapLines(
        doc,
        truck.outstandingFaultCodes[0] ?? EMPTY_CELL,
        {
          font: "bold",
          size: 6.8,
          color: truck.caseStatus === "VERIFIED_CLOSED" ? GREEN_DARK : MUTED,
        },
        width
      )
    )
  } else {
    truck.outstandingItems.forEach((item, index) => {
      const regression = item.status === "NEW_REGRESSION"
      const repeat = item.repeatCount >= 1
      const style: Partial<StyleSpec> = regression
        ? {
            font: "bold",
            color: RED_DARK,
            bg: [254, 226, 226],
            accent: [220, 38, 38],
            inset: 1.2,
            padTop: 0.5,
            padBottom: 0.5,
          }
        : repeat
          ? {
              font: "bold",
              color: [154, 52, 18],
              bg: [254, 243, 199],
              accent: [217, 119, 6],
              inset: 1.2,
              padTop: 0.5,
              padBottom: 0.5,
            }
          : {}
      lines.push(
        ...wrapLines(
          doc,
          formatOutstandingLine(item),
          {
            font: "normal",
            size: 6.8,
            color: INK,
            indent: 2.8,
            bullet: "\u2022",
            gapBefore: index === 0 ? 0 : 0.9,
            ...style,
          },
          width
        )
      )
    })
  }
  if (truck.approvedExceptionsNote) {
    lines.push(
      ...wrapLines(
        doc,
        truck.approvedExceptionsNote,
        { font: "italic", size: 6.2, color: MUTED, gapBefore: 1.8 },
        width
      )
    )
  }
  return lines
}

function diagnosisCell(
  doc: jsPDF,
  truck: PttReportTruck,
  width: number
): RichLine[] {
  const lines: RichLine[] = []
  if (truck.caseStatus === "CLOSED_ACCEPTED_RESIDUALS") {
    const detail = [
      truck.closureReasonLabel && `Reason: ${truck.closureReasonLabel}`,
      truck.closureNote && `Note: ${truck.closureNote}`,
      truck.closedDate && `Closed: ${truck.closedDate}`,
    ]
      .filter(Boolean)
      .join("  |  ")
    lines.push(
      ...callout(
        doc,
        "CLOSED (ACCEPTED RESIDUALS)",
        detail || "Closed by a manager with residual faults accepted.",
        width,
        {
          labelBg: [13, 148, 136],
          labelText: [255, 255, 255],
          bodyBg: [204, 251, 241],
          bodyText: [19, 78, 74],
          accent: [15, 118, 110],
        }
      )
    )
  }
  if (truck.collateralDamageAnalysis) {
    lines.push(
      ...callout(doc, "COLLATERAL DAMAGE", truck.collateralDamageAnalysis, width, {
        labelBg: [220, 38, 38],
        labelText: [255, 255, 255],
        bodyBg: [254, 226, 226],
        bodyText: RED_DARK,
        accent: [153, 27, 27],
      })
    )
  }
  if (truck.trueDiagnosis) {
    lines.push(
      ...sectionLabel(doc, "True Diagnosis", width),
      ...wrapLines(doc, truck.trueDiagnosis, { font: "normal", size: 6.8, color: INK }, width)
    )
  }
  if (truck.partsWarning) {
    lines.push(
      ...callout(doc, "PARTS WARNING", truck.partsWarning, width, {
        labelBg: [217, 119, 6],
        labelText: [255, 255, 255],
        bodyBg: [255, 243, 205],
        bodyText: [120, 53, 15],
        accent: [180, 83, 9],
      })
    )
  }
  return lines.length > 0 ? lines : mutedLine(doc, EMPTY_CELL, width)
}

function checksCell(doc: jsPDF, truck: PttReportTruck, width: number): RichLine[] {
  const lines: RichLine[] = []
  if (truck.nextFloorActions.length > 0) {
    lines.push(
      ...wrapLines(
        doc,
        "NEXT FLOOR ACTIONS",
        {
          font: "bold",
          size: 6.3,
          color: [255, 255, 255],
          bg: [29, 78, 216],
          accent: [30, 58, 138],
          inset: 1.4,
          padTop: 0.7,
          gapBefore: 0,
        },
        width
      ),
      ...truck.nextFloorActions.flatMap((action, index) =>
        wrapLines(
          doc,
          action,
          {
            font: "bold",
            size: 6.8,
            color: [30, 58, 138],
            bg: [219, 234, 254],
            accent: [30, 58, 138],
            inset: 1.4,
            indent: 3.4,
            bullet: `${index + 1}.`,
            padTop: index === 0 ? 0.6 : 0,
            padBottom: index === truck.nextFloorActions.length - 1 ? 0.9 : 0.3,
          },
          width
        )
      )
    )
  }
  if (truck.physicalChecks.length > 0) {
    lines.push(
      ...sectionLabel(doc, "Physical Checks", width),
      ...listLines(doc, truck.physicalChecks, width, true)
    )
  }
  return lines.length > 0 ? lines : mutedLine(doc, EMPTY_CELL, width)
}

function pathsCell(doc: jsPDF, truck: PttReportTruck, width: number): RichLine[] {
  const lines: RichLine[] = []
  if (truck.pttPaths.length > 0) {
    lines.push(
      ...sectionLabel(doc, "PTT Paths", width),
      ...listLines(doc, truck.pttPaths, width, false)
    )
  }
  if (truck.verificationCriteria.length > 0) {
    lines.push(
      ...sectionLabel(doc, "Verification Criteria", width),
      ...listLines(doc, truck.verificationCriteria, width, false)
    )
  }
  return lines.length > 0 ? lines : mutedLine(doc, EMPTY_CELL, width)
}

export function drawLine(
  doc: jsPDF,
  line: RichLine,
  x: number,
  y: number,
  width: number
): void {
  const top = y + (line.gapBefore ?? 0)
  const boxHeight = (line.padTop ?? 0) + lineHeightOf(line.size) + (line.padBottom ?? 0)
  const inset = line.inset ?? 0

  doc.setFont("helvetica", line.font)
  doc.setFontSize(line.size)

  if (line.bg) {
    doc.setFillColor(...line.bg)
    if (line.badge) {
      const badgeWidth = doc.getTextWidth(line.text) + inset * 2
      doc.roundedRect(x, top, badgeWidth, boxHeight, 1, 1, "F")
    } else {
      doc.rect(x, top, width, boxHeight, "F")
      if (line.accent) {
        doc.setFillColor(...line.accent)
        doc.rect(x, top, 0.8, boxHeight, "F")
      }
    }
  }

  const sizeMm = line.size * PT_TO_MM
  const baseline =
    top + (line.padTop ?? 0) + (lineHeightOf(line.size) - sizeMm) / 2 + sizeMm * 0.8
  const textX = x + inset + (line.accent && !line.badge ? 0.8 : 0) + (line.indent ?? 0)
  doc.setTextColor(...line.color)
  if (line.bullet) {
    doc.text(line.bullet, textX - (line.indent ?? 0), baseline)
  }
  doc.text(line.text, textX, baseline)
}

export type RichTableSpec<Row> = {
  /** Printed (small, grey) at the top of every continuation page. */
  title: string
  headers: readonly string[]
  /** Column widths as % of the printable width (sums to 100). */
  ratios: readonly number[]
  /** Top of the table (mm). */
  startY: number
  rows: readonly Row[]
  /** One list of styled lines per column; `inner` are the text widths (mm). */
  buildCells: (row: Row, inner: readonly number[]) => RichLine[][]
  /** Heads the first column of the tail when a tall row is split. */
  continuationLabel: (row: Row) => string
  emptyMessage: string
}

/**
 * Purpose-built rich table on top of jsPDF: the row height is the tallest
 * cell, a row never straddles a page when it fits on one, a row taller than a
 * page is split line-by-line (its tail starts with `continuationLabel`), and
 * the header repeats on every page.
 */
export function drawRichTable<Row>(doc: jsPDF, spec: RichTableSpec<Row>): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const printable = pageWidth - PAGE_MARGIN * 2
  const widths = spec.ratios.map((ratio) => (printable * ratio) / 100)
  const columnX = widths.map((_, index) =>
    widths.slice(0, index).reduce((sum, w) => sum + w, PAGE_MARGIN)
  )
  const pageBottom = pageHeight - FOOTER_RESERVE

  let y = spec.startY
  let tableStart = y

  const drawTableHeader = () => {
    doc.setFillColor(30, 41, 59)
    doc.rect(PAGE_MARGIN, y, printable, HEADER_HEIGHT, "F")
    doc.setFont("helvetica", "bold")
    doc.setFontSize(7.6)
    doc.setTextColor(255, 255, 255)
    spec.headers.forEach((label, index) => {
      doc.text(label, columnX[index] + CELL_PAD_X, y + 4.6)
    })
    y += HEADER_HEIGHT
    tableStart = y
  }

  const newPage = () => {
    doc.addPage()
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8)
    doc.setTextColor(90, 90, 90)
    doc.text(`${spec.title} (continued)`, PAGE_MARGIN, 9)
    y = 12
    drawTableHeader()
  }

  const drawSegment = (columns: readonly RichLine[][], stripe: boolean) => {
    const height = Math.max(
      9,
      Math.max(...columns.map(heightOfLines)) + CELL_PAD_Y * 2
    )
    if (stripe) {
      doc.setFillColor(247, 248, 250)
      doc.rect(PAGE_MARGIN, y, printable, height, "F")
    }
    doc.setDrawColor(209, 213, 219)
    doc.setLineWidth(0.15)
    columns.forEach((lines, index) => {
      doc.rect(columnX[index], y, widths[index], height, "S")
      let cursor = y + CELL_PAD_Y
      for (const line of lines) {
        drawLine(
          doc,
          line,
          columnX[index] + CELL_PAD_X,
          cursor,
          widths[index] - CELL_PAD_X * 2
        )
        cursor += heightOfLine(line)
      }
    })
    y += height
  }

  if (spec.rows.length === 0) {
    doc.setFont("helvetica", "italic")
    doc.setFontSize(10)
    doc.setTextColor(120, 120, 120)
    doc.text(spec.emptyMessage, PAGE_MARGIN, y + 6)
  } else {
    drawTableHeader()
  }

  spec.rows.forEach((row, rowIndex) => {
    const inner = widths.map((w) => w - CELL_PAD_X * 2)
    let remaining: RichLine[][] = spec.buildCells(row, inner)
    const stripe = rowIndex % 2 === 1

    for (;;) {
      const needed =
        Math.max(9, Math.max(...remaining.map(heightOfLines)) + CELL_PAD_Y * 2)
      const available = pageBottom - y
      if (needed <= available) {
        drawSegment(remaining, stripe)
        return
      }

      const capacity = pageBottom - (12 + HEADER_HEIGHT)
      const atTop = y <= tableStart + 0.01
      // Fits on a fresh page: move it there whole instead of splitting it.
      if (!atTop && needed <= capacity) {
        newPage()
        continue
      }

      // Taller than a page: split every column at the page boundary.
      const budget = available - CELL_PAD_Y * 2
      const heads: RichLine[][] = []
      const tails: RichLine[][] = []
      for (const column of remaining) {
        let used = 0
        let take = 0
        while (take < column.length) {
          const next = heightOfLine(column[take])
          if (used + next > budget && !(atTop && take === 0)) break
          used += next
          take += 1
        }
        heads.push(column.slice(0, take))
        tails.push(
          column.slice(take).map((line, index) =>
            index === 0 ? { ...line, gapBefore: 0 } : line
          )
        )
      }
      if (heads.every((head) => head.length === 0)) {
        newPage()
        continue
      }
      drawSegment(heads, stripe)
      if (tails.every((tail) => tail.length === 0)) return

      tails[0] = [
        ...wrapLines(
          doc,
          spec.continuationLabel(row),
          { font: "bold", size: 7.5, color: [71, 85, 105] },
          inner[0]
        ),
        ...tails[0],
      ]
      remaining = tails
      newPage()
    }
  })
}

export function buildExecutiveDirectivesPdf(data: PttReportData): PttPdfResult {
  const title = PTT_EXECUTIVE_REPORT_TITLE
  const doc = newDoc(title)
  const { kpis, trucks, options } = data

  const subtitleY = drawHeader(doc, data, title, [
    `${trucks.length} ${trucks.length === 1 ? "truck" : "trucks"} \u2014 workshop handover: what was cleared, what is still outstanding, what to check and how to prove the fix.`,
  ])

  const kpiBottom = drawKpiStrip(doc, subtitleY + 5, [
    { label: "Trucks", value: String(kpis.trucksCount) },
    highlightedKpi("Open / Blocked", kpis.openOrBlockedCount, "MONITOR"),
    highlightedKpi("Verified Closed", kpis.verifiedClosedCount, "GREEN"),
    highlightedKpi("Faults Cleared", kpis.verifiedClearedCount, "GREEN"),
    highlightedKpi("Outstanding Actionable", kpis.outstandingActionableCount, "CRITICAL"),
    highlightedKpi("New Regressions", kpis.newRegressionsCount, "CRITICAL"),
    {
      label: "First-Time Fix Rate %",
      value:
        kpis.firstTimeFixRatePct === null ? "N/A" : `${kpis.firstTimeFixRatePct}%`,
    },
  ])

  drawRichTable(doc, {
    title,
    headers: EXECUTIVE_HEADERS,
    ratios: EXECUTIVE_COLUMN_RATIOS,
    startY: kpiBottom + 6,
    rows: trucks,
    buildCells: (truck, inner) => [
      truckCell(doc, truck, inner[0]),
      clearedCell(doc, truck, inner[1]),
      outstandingCell(doc, truck, inner[2]),
      diagnosisCell(doc, truck, inner[3]),
      checksCell(doc, truck, inner[4]),
      pathsCell(doc, truck, inner[5]),
    ],
    continuationLabel: (truck) => `${truck.fleetId} (cont.)`,
    emptyMessage: "No trucks match the selected filters.",
  })

  drawFooters(doc, data.generatedAt)
  return {
    fileName: pttReportFileName("EXECUTIVE_PDF", options.scope, data.generatedAt),
    title,
    buffer: doc.output("arraybuffer"),
    pageCount: doc.getNumberOfPages(),
  }
}
