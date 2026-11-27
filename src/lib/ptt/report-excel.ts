import type { Cell, Workbook } from "exceljs"

import type { PttOverallSeverity } from "../ptt-diagnostics"
import {
  PTT_REPORT_FAULT_STATUS_LABELS,
  PTT_SEVERITY_DISPLAY,
  pttReportFileName,
  type PttReportData,
  type PttReportFaultRow,
  type PttReportFaultStatus,
  type PttReportLedgerItem,
  type PttReportTruck,
} from "./report-data"
import type { PttLedgerStatus } from "./constants"

// The single 3-tab Fleet Diagnostics workbook, executive-first:
//   1. Executive Truck Directives  (one row per truck)
//   2. Fault Register              (one row per fault, per-fault action only)
//   3. Truck Fault Ledger          (living truck-level fault history)
// Built from the same `PttReportData` as both PDFs. `exceljs` is loaded on
// demand so the (large) library stays out of the initial bundle.

export const PTT_WORKBOOK_SHEET_NAMES = [
  "Executive Truck Directives",
  "Fault Register",
  "Truck Fault Ledger",
] as const

export const EXECUTIVE_SHEET_HEADERS = [
  "Fleet No.",
  "Gen",
  "Baseline Date",
  "Last Verified Date",
  "Case Status",
  "Overall Severity",
  "Cleared Count",
  "Outstanding Count",
  "New Regressions Count",
  "Approved Exceptions Count",
  "Cleared Fault Codes",
  "Outstanding Fault Codes",
  "Forensic Verification Audit",
  "True Diagnosis",
  "Parts Warning",
  "Physical Checks",
  "PTT Paths",
  "Verification Criteria",
] as const

export const FAULT_REGISTER_HEADERS = [
  "Date",
  "Fleet No.",
  "Gen",
  "Canonical Key",
  "Fault Code",
  "Control Unit (ECU)",
  "State",
  "Count",
  "PTT Fault Description",
  "Severity",
  "Cal. Req.",
  "Reconciliation Status",
  "Repeat / Reopen Count",
  "Per-Fault Intervention",
] as const

export const LEDGER_SHEET_HEADERS = [
  "Fleet No.",
  "Gen",
  "Canonical Key",
  "Control Unit (ECU)",
  "Description",
  "Latest Severity",
  "Ledger Status",
  "First Seen Date",
  "Last Seen Date",
  "Cleared Date",
  "Days Open",
  "Reopen Count",
  "Last Reopened Date",
] as const

export type CellValue = string | number | null

export type Column<Row> = {
  header: string
  width: number
  center?: boolean
  value: (row: Row) => CellValue
}

export type Look = { fill: string; font: string; bold?: boolean }

const SEVERITY_LOOK: Record<PttOverallSeverity, Look> = {
  CRITICAL: { fill: "FFFECACA", font: "FF991B1B", bold: true },
  CALIBRATION_ONLY: { fill: "FFE9D5FF", font: "FF6B21A8", bold: true },
  MONITOR: { fill: "FFFDE68A", font: "FF92400E", bold: true },
  NEGLIGIBLE: { fill: "FFE5E7EB", font: "FF374151", bold: true },
  CLEAR: { fill: "FFD1FAE5", font: "FF065F46", bold: true },
}

export const GREEN: Look = { fill: "FFD1FAE5", font: "FF065F46", bold: true }
export const SOFT_RED: Look = { fill: "FFFECACA", font: "FF991B1B", bold: true }
export const SOFT_AMBER: Look = { fill: "FFFDE68A", font: "FF92400E", bold: true }
export const STRONG_RED: Look = { fill: "FFDC2626", font: "FFFFFFFF", bold: true }
const SLATE: Look = { fill: "FFE2E8F0", font: "FF475569", bold: true }
export const GREY: Look = { fill: "FFF3F4F6", font: "FF6B7280" }
const ORANGE: Look = { fill: "FFFED7AA", font: "FF9A3412", bold: true }

// Soft blue-green: closed by a manager release, not by a clean re-scan.
const TEAL: Look = { fill: "FFCCFBF1", font: "FF115E59", bold: true }

const CASE_STATUS_LOOK: Record<PttReportTruck["caseStatusLabel"], Look> = {
  "VERIFIED CLOSED": GREEN,
  "CLOSED (ACCEPTED RESIDUALS)": TEAL,
  "PARTIAL / BLOCKED": SOFT_RED,
  "NO PROGRESS": SOFT_RED,
  OPEN: SOFT_AMBER,
}

const FAULT_STATUS_LOOK: Record<PttReportFaultStatus, Look> = {
  CLEARED: GREEN,
  STILL_OPEN: SOFT_AMBER,
  NEW_REGRESSION: STRONG_RED,
  APPROVED_EXCEPTION: SLATE,
  INACTIVE: GREY,
}

const LEDGER_STATUS_LOOK: Record<PttLedgerStatus, Look> = {
  REOPENED: ORANGE,
  OPEN: SOFT_RED,
  CLEARED: GREEN,
  APPROVED_EXCEPTION: SLATE,
}

const numbered = (items: readonly string[]) =>
  items.map((item, index) => `${index + 1}. ${item}`).join("\n")
const bulleted = (items: readonly string[]) =>
  items.map((item) => `\u2022 ${item}`).join("\n")

function closureAudit(truck: PttReportTruck): string {
  if (truck.caseStatus !== "CLOSED_ACCEPTED_RESIDUALS") return ""
  return [
    "CLOSED (ACCEPTED RESIDUALS)",
    truck.closureReasonLabel && `Reason: ${truck.closureReasonLabel}`,
    truck.closureNote && `Note: ${truck.closureNote}`,
    truck.closedDate && `Closed: ${truck.closedDate}`,
  ]
    .filter(Boolean)
    .join("\n")
}

function forensicAudit(truck: PttReportTruck): string {
  const closure = closureAudit(truck)
  if (!truck.isVerified) return closure
  const parts: string[] = closure ? [closure] : []
  if (truck.verdictHeadline) parts.push(truck.verdictHeadline)
  if (truck.collateralDamageAnalysis) {
    parts.push(`Collateral damage: ${truck.collateralDamageAnalysis}`)
  }
  if (truck.nextFloorActions.length > 0) {
    parts.push(`Next floor actions:\n${numbered(truck.nextFloorActions)}`)
  }
  return parts.join("\n\n")
}

const executiveColumns: Column<PttReportTruck>[] = [
  { header: "Fleet No.", width: 11, value: (t) => t.fleetId },
  { header: "Gen", width: 8, center: true, value: (t) => t.generation },
  { header: "Baseline Date", width: 13, center: true, value: (t) => t.baselineDate },
  {
    header: "Last Verified Date",
    width: 13,
    center: true,
    value: (t) => t.lastVerifiedDate,
  },
  { header: "Case Status", width: 19, center: true, value: (t) => t.caseStatusLabel },
  {
    header: "Overall Severity",
    width: 17,
    center: true,
    value: (t) => PTT_SEVERITY_DISPLAY[t.overallSeverity],
  },
  { header: "Cleared Count", width: 10, center: true, value: (t) => t.clearedCount },
  {
    header: "Outstanding Count",
    width: 12,
    center: true,
    value: (t) => t.outstandingCount,
  },
  {
    header: "New Regressions Count",
    width: 13,
    center: true,
    value: (t) => t.newRegressionsCount,
  },
  {
    header: "Approved Exceptions Count",
    width: 13,
    center: true,
    value: (t) => t.approvedExceptionsCount,
  },
  {
    header: "Cleared Fault Codes",
    width: 48,
    value: (t) => t.clearedFaultCodes.join("\n"),
  },
  {
    header: "Outstanding Fault Codes",
    width: 56,
    value: (t) =>
      [...t.outstandingFaultCodes, t.approvedExceptionsNote ?? ""]
        .filter(Boolean)
        .join("\n"),
  },
  { header: "Forensic Verification Audit", width: 60, value: forensicAudit },
  { header: "True Diagnosis", width: 50, value: (t) => t.trueDiagnosis },
  { header: "Parts Warning", width: 50, value: (t) => t.partsWarning },
  { header: "Physical Checks", width: 60, value: (t) => numbered(t.physicalChecks) },
  { header: "PTT Paths", width: 50, value: (t) => bulleted(t.pttPaths) },
  {
    header: "Verification Criteria",
    width: 50,
    value: (t) => bulleted(t.verificationCriteria),
  },
]

const faultColumns: Column<PttReportFaultRow>[] = [
  { header: "Date", width: 12, center: true, value: (r) => r.scanDate },
  { header: "Fleet No.", width: 11, value: (r) => r.fleetId },
  { header: "Gen", width: 8, center: true, value: (r) => r.generation },
  { header: "Canonical Key", width: 24, value: (r) => r.canonicalKey },
  {
    header: "Fault Code",
    width: 20,
    value: (r) => r.dtcRaw || r.codeLabel,
  },
  { header: "Control Unit (ECU)", width: 24, value: (r) => r.ecuLabel },
  { header: "State", width: 10, center: true, value: (r) => r.faultState },
  { header: "Count", width: 8, center: true, value: (r) => r.occurrenceCount },
  { header: "PTT Fault Description", width: 44, value: (r) => r.description },
  {
    header: "Severity",
    width: 18,
    center: true,
    value: (r) => PTT_SEVERITY_DISPLAY[r.severity],
  },
  {
    header: "Cal. Req.",
    width: 10,
    center: true,
    value: (r) => (r.calibrationRequired ? "Yes" : "No"),
  },
  {
    header: "Reconciliation Status",
    width: 20,
    center: true,
    value: (r) => PTT_REPORT_FAULT_STATUS_LABELS[r.status],
  },
  {
    header: "Repeat / Reopen Count",
    width: 12,
    center: true,
    value: (r) => r.repeatCount,
  },
  { header: "Per-Fault Intervention", width: 70, value: (r) => r.intervention },
]

const ledgerColumns: Column<PttReportLedgerItem>[] = [
  { header: "Fleet No.", width: 11, value: (r) => r.fleetId },
  { header: "Gen", width: 8, center: true, value: (r) => r.generation },
  { header: "Canonical Key", width: 26, value: (r) => r.canonicalKey },
  { header: "Control Unit (ECU)", width: 24, value: (r) => r.ecuLabel },
  { header: "Description", width: 46, value: (r) => r.description },
  {
    header: "Latest Severity",
    width: 17,
    center: true,
    value: (r) => PTT_SEVERITY_DISPLAY[r.latestSeverity],
  },
  { header: "Ledger Status", width: 20, center: true, value: (r) => r.ledgerStatus },
  { header: "First Seen Date", width: 13, center: true, value: (r) => r.firstSeenDate },
  { header: "Last Seen Date", width: 13, center: true, value: (r) => r.lastSeenDate },
  { header: "Cleared Date", width: 13, center: true, value: (r) => r.clearedDate },
  { header: "Days Open", width: 10, center: true, value: (r) => r.daysOpen },
  { header: "Reopen Count", width: 10, center: true, value: (r) => r.reopenCount },
  {
    header: "Last Reopened Date",
    width: 14,
    center: true,
    value: (r) => r.lastReopenedDate,
  },
]

const ROW_LINE_HEIGHT = 14.5
const MAX_ROW_HEIGHT = 409

// Excel does not auto-fit rows that contain explicit line breaks, so estimate
// the wrapped height from the text length and the column width.
export function estimateRowHeight(
  values: readonly CellValue[],
  widths: readonly number[]
): number {
  let maxLines = 1
  values.forEach((value, index) => {
    if (value === null) return
    const charsPerLine = Math.max(4, Math.floor(widths[index] * 0.95))
    let lines = 0
    for (const segment of String(value).split("\n")) {
      lines += Math.max(1, Math.ceil(segment.length / charsPerLine))
    }
    maxLines = Math.max(maxLines, lines)
  })
  return Math.min(MAX_ROW_HEIGHT, Math.max(18, maxLines * ROW_LINE_HEIGHT + 4))
}

export function applyLook(cell: Cell, look: Look): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: look.fill } }
  cell.font = { bold: look.bold ?? false, color: { argb: look.font } }
}

export function addSheet<Row>(
  workbook: Workbook,
  name: string,
  columns: readonly Column<Row>[],
  rows: readonly Row[],
  decorate: (row: Row, cellOf: (header: string) => Cell | undefined) => void
): void {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
  })
  sheet.columns = columns.map((column, index) => ({
    header: column.header,
    key: `c${index}`,
    width: column.width,
  }))
  const widths = columns.map((column) => column.width)

  const headerRow = sheet.getRow(1)
  headerRow.height = 30
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E293B" },
    }
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true }
  })

  const thin = { style: "thin" as const, color: { argb: "FFD1D5DB" } }
  const border = { top: thin, left: thin, bottom: thin, right: thin }

  rows.forEach((row) => {
    const values = columns.map((column) => column.value(row))
    const excelRow = sheet.addRow(values)
    excelRow.height = estimateRowHeight(values, widths)
    columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1)
      cell.alignment = {
        vertical: "top",
        horizontal: column.center ? "center" : "left",
        wrapText: true,
      }
      cell.border = border
    })
    decorate(row, (header) => {
      const index = columns.findIndex((column) => column.header === header)
      return index < 0 ? undefined : excelRow.getCell(index + 1)
    })
  })

  headerRow.eachCell((cell) => {
    cell.border = border
  })
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  }
}

/** Builds the 3-tab workbook (no download, no I/O). */
export async function buildPttWorkbook(data: PttReportData): Promise<Workbook> {
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Miloto Transport Limited"
  workbook.created = data.generatedAt

  addSheet(
    workbook,
    PTT_WORKBOOK_SHEET_NAMES[0],
    executiveColumns,
    data.trucks,
    (truck, cellOf) => {
      const status = cellOf("Case Status")
      if (status) applyLook(status, CASE_STATUS_LOOK[truck.caseStatusLabel])
      const severity = cellOf("Overall Severity")
      if (severity) applyLook(severity, SEVERITY_LOOK[truck.overallSeverity])
      const regressions = cellOf("New Regressions Count")
      if (regressions && truck.newRegressionsCount > 0) {
        applyLook(regressions, STRONG_RED)
      }
    }
  )

  addSheet(
    workbook,
    PTT_WORKBOOK_SHEET_NAMES[1],
    faultColumns,
    data.faultRows,
    (row, cellOf) => {
      const severity = cellOf("Severity")
      if (severity) applyLook(severity, SEVERITY_LOOK[row.severity])
      const status = cellOf("Reconciliation Status")
      if (status) applyLook(status, FAULT_STATUS_LOOK[row.status])
      const repeats = cellOf("Repeat / Reopen Count")
      if (repeats && row.repeatCount > 0) applyLook(repeats, SOFT_RED)
    }
  )

  addSheet(
    workbook,
    PTT_WORKBOOK_SHEET_NAMES[2],
    ledgerColumns,
    data.ledgerRows,
    (row, cellOf) => {
      const severity = cellOf("Latest Severity")
      if (severity) applyLook(severity, SEVERITY_LOOK[row.latestSeverity])
      const status = cellOf("Ledger Status")
      if (status) applyLook(status, LEDGER_STATUS_LOOK[row.ledgerStatus])
    }
  )

  return workbook
}

export type PttWorkbookResult = {
  fileName: string
  buffer: ArrayBuffer
}

/** The workbook as `.xlsx` bytes plus its file name. */
export async function buildPttWorkbookFile(
  data: PttReportData
): Promise<PttWorkbookResult> {
  const workbook = await buildPttWorkbook(data)
  return {
    fileName: pttReportFileName("EXCEL", data.options.scope, data.generatedAt),
    buffer: await workbook.xlsx.writeBuffer(),
  }
}
