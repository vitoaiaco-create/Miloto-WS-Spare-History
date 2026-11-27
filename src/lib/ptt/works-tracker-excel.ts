import { format } from "date-fns"
import type { Cell, Workbook, Worksheet } from "exceljs"

import {
  GREEN,
  GREY,
  SOFT_AMBER,
  SOFT_RED,
  addSheet,
  applyLook,
  type Column,
  type Look,
} from "./report-excel"
import {
  describeWorksTrackerFilters,
  describeWorksTrackerOrder,
  pttWorksTrackerFileName,
  type WorksTrackerData,
  type WorksTrackerOutcome,
  type WorksTrackerRow,
  type WorksTrackerStatus,
} from "./works-tracker-data"

// The standalone Fleet Diagnostic Works Tracker workbook:
//   1. Works Tracker  (one row per active truck)
//   2. Sweep Summary  (KPIs + generation breakdown, live Excel formulas that
//                      reference tab 1, so they follow any filter / edit)
// Built from the same `WorksTrackerData` as the PDF. `exceljs` is loaded on
// demand, so the (large) library stays out of the initial bundle.

export const WORKS_TRACKER_SHEET_NAMES = ["Works Tracker", "Sweep Summary"] as const

export const WORKS_TRACKER_SHEET_HEADERS = [
  "Fleet No.",
  "Gen",
  "Tracker Status",
  "Closure Outcome",
  "Before Photo Date",
  "After Photo Date",
  "Turnaround / Open Days",
  "Before Faults",
  "Cleared Faults",
  "Residual Faults",
  "Cleared Fault Codes",
  "Residual Fault Codes",
] as const

const STATUS_LOOK: Record<WorksTrackerStatus, Look> = {
  COMPLETE: GREEN,
  PARTIAL: SOFT_AMBER,
  PENDING: GREY,
}

const OUTCOME_LOOK: Partial<Record<WorksTrackerOutcome, Look>> = {
  "Clean Closure": GREEN,
  // Soft blue-green, same as the Fault Report's case-status cell.
  "Closed (Accepted Residuals)": {
    fill: "FFCCFBF1",
    font: "FF115E59",
    bold: true,
  },
  "Residual Faults": SOFT_RED,
  "No Progress": SOFT_RED,
  "Fault Clearance Pending": SOFT_AMBER,
}

const trackerColumns: Column<WorksTrackerRow>[] = [
  { header: "Fleet No.", width: 11, value: (r) => r.fleetId },
  { header: "Gen", width: 8, center: true, value: (r) => r.generation },
  { header: "Tracker Status", width: 15, center: true, value: (r) => r.trackerStatus },
  { header: "Closure Outcome", width: 17, center: true, value: (r) => r.closureOutcome },
  { header: "Before Photo Date", width: 14, center: true, value: (r) => r.beforePhotoDate },
  { header: "After Photo Date", width: 14, center: true, value: (r) => r.afterPhotoDate },
  {
    header: "Turnaround / Open Days",
    width: 13,
    center: true,
    value: (r) => r.turnaroundDays,
  },
  { header: "Before Faults", width: 10, center: true, value: (r) => r.openingFaultsCount },
  { header: "Cleared Faults", width: 10, center: true, value: (r) => r.clearedFaultsCount },
  { header: "Residual Faults", width: 10, center: true, value: (r) => r.residualFaultsCount },
  { header: "Cleared Fault Codes", width: 56, value: (r) => r.clearedFaultCodes },
  { header: "Residual Fault Codes", width: 56, value: (r) => r.residualFaultCodes },
]

// Column letters of the tracker sheet used by the summary formulas.
const COL = {
  gen: "B",
  status: "C",
  outcome: "D",
  cleared: "I",
  residual: "J",
}
const ACCEPTED_OUTCOME = "Closed (Accepted Residuals)"
const FIRST_DATA_ROW = 2
const SUMMARY_SHEET = WORKS_TRACKER_SHEET_NAMES[0]

const HEADER_FILL = "FF1E293B"
const thin = { style: "thin" as const, color: { argb: "FFD1D5DB" } }
const BORDER = { top: thin, left: thin, bottom: thin, right: thin }

function styleHeaderCell(cell: Cell): void {
  cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } }
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  cell.border = BORDER
}

function styleBodyCell(cell: Cell, align: "left" | "center"): void {
  cell.alignment = { vertical: "middle", horizontal: align, wrapText: true }
  cell.border = BORDER
}

const percentOf = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 1000 : 0

type SummaryLine = {
  label: string
  formula: string
  result: number
  percent?: boolean
}

function buildSummarySheet(workbook: Workbook, data: WorksTrackerData): Worksheet {
  const sheet = workbook.addWorksheet(WORKS_TRACKER_SHEET_NAMES[1], {
    views: [{ state: "frozen", ySplit: 1 }],
  })
  sheet.columns = [
    { width: 38 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
  ]

  const last = Math.max(FIRST_DATA_ROW, data.rows.length + 1)
  const range = (column: string) =>
    `'${SUMMARY_SHEET}'!$${column}$${FIRST_DATA_ROW}:$${column}$${last}`

  sheet.mergeCells("A1:F1")
  const title = sheet.getCell("A1")
  title.value = "Fleet Diagnostic Works Tracker \u2014 Sweep Summary"
  title.font = { bold: true, size: 14, color: { argb: "FF1E293B" } }
  title.alignment = { vertical: "middle", horizontal: "left" }
  sheet.getRow(1).height = 26

  sheet.mergeCells("A2:F2")
  sheet.getCell("A2").value = `${describeWorksTrackerFilters(data.options)}  |  ${describeWorksTrackerOrder(data)}`
  sheet.mergeCells("A3:F3")
  sheet.getCell("A3").value =
    `Generated ${format(data.generatedAt, "dd MMM yyyy, HH:mm:ss")}. Every figure below is a live formula over the "${SUMMARY_SHEET}" tab.`
  for (const address of ["A2", "A3"]) {
    sheet.getCell(address).font = { size: 9, color: { argb: "FF64748B" } }
  }

  const { kpis } = data
  const statusCount = (status: string) =>
    `COUNTIF(${range(COL.status)},"${status}")`

  // --- Overall Sweep Progress --------------------------------------------
  const overallHeader = 5
  sheet.getCell(`A${overallHeader}`).value = "Overall Sweep Progress"
  sheet.getCell(`B${overallHeader}`).value = "Value"
  styleHeaderCell(sheet.getCell(`A${overallHeader}`))
  styleHeaderCell(sheet.getCell(`B${overallHeader}`))
  sheet.getCell(`A${overallHeader}`).alignment = {
    vertical: "middle",
    horizontal: "left",
  }

  const row = (offset: number) => overallHeader + offset
  const lines: SummaryLine[] = [
    {
      label: "Total Fleet",
      formula: `COUNTA(${range("A")})`,
      result: kpis.totalFleet,
    },
    {
      label: "Complete",
      formula: statusCount("COMPLETE"),
      result: kpis.completeCount,
    },
    {
      label: "Partial",
      formula: statusCount("PARTIAL"),
      result: kpis.partialCount,
    },
    {
      label: "Pending",
      formula: statusCount("PENDING"),
      result: kpis.pendingCount,
    },
    {
      label: "% Complete",
      formula: `IF(B${row(1)}=0,0,ROUND(B${row(2)}/B${row(1)},3))`,
      result: percentOf(kpis.completeCount, kpis.totalFleet),
      percent: true,
    },
    {
      // Clean Closures + Closed (Accepted Residuals) + Complete with Residual
      // Faults always add up to Complete.
      label: "Clean Closures",
      formula: `COUNTIFS(${range(COL.status)},"COMPLETE",${range(COL.outcome)},"<>${ACCEPTED_OUTCOME}",${range(COL.residual)},0)`,
      result: kpis.cleanClosureCount,
    },
    {
      label: "Closed (Accepted Residuals)",
      formula: `COUNTIFS(${range(COL.status)},"COMPLETE",${range(COL.outcome)},"${ACCEPTED_OUTCOME}")`,
      result: kpis.closedAcceptedResidualsCount,
    },
    {
      label: "Complete with Residual Faults",
      formula: `COUNTIFS(${range(COL.status)},"COMPLETE",${range(COL.outcome)},"<>${ACCEPTED_OUTCOME}",${range(COL.residual)},">0")`,
      result: kpis.residualFaultsTrucksCount,
    },
    {
      label: "Total Cleared Faults",
      formula: `SUM(${range(COL.cleared)})`,
      result: kpis.totalClearedFaults,
    },
    {
      label: "Total Residual Faults",
      formula: `SUM(${range(COL.residual)})`,
      result: kpis.totalResidualFaults,
    },
  ]
  lines.forEach((line, index) => {
    const r = row(index + 1)
    const label = sheet.getCell(`A${r}`)
    label.value = line.label
    label.font = { bold: true }
    styleBodyCell(label, "left")
    const value = sheet.getCell(`B${r}`)
    value.value = { formula: line.formula, result: line.result }
    if (line.percent) value.numFmt = "0.0%"
    styleBodyCell(value, "center")
  })

  // --- Breakdown by Generation -------------------------------------------
  const genHeader = row(lines.length) + 3
  const genHeaders = ["Generation", "Total", "Complete", "Partial", "Pending", "% Complete"]
  genHeaders.forEach((label, index) => {
    const cell = sheet.getCell(genHeader, index + 1)
    cell.value = label
    styleHeaderCell(cell)
  })
  sheet.getCell(genHeader, 1).alignment = { vertical: "middle", horizontal: "left" }

  type Generation = { label: string; criterion: string }
  const generations: Generation[] = [
    { label: "FH V3", criterion: "FH V3" },
    { label: "FH V4", criterion: "FH V4" },
  ]
  // Trucks never scanned have no known generation: keep the totals reconciled.
  if (data.rows.some((r) => r.generation === "\u2014")) {
    generations.push({ label: "Unknown (not yet identified)", criterion: "\u2014" })
  }

  generations.forEach((generation, index) => {
    const r = genHeader + 1 + index
    const matching = data.rows.filter((x) => x.generation === generation.criterion)
    const countOf = (status: WorksTrackerStatus) =>
      matching.filter((x) => x.trackerStatus === status).length
    const gen = `${range(COL.gen)},"${generation.criterion}"`
    const withStatus = (status: string) =>
      `COUNTIFS(${gen},${range(COL.status)},"${status}")`

    const label = sheet.getCell(r, 1)
    label.value = generation.label
    label.font = { bold: true }
    styleBodyCell(label, "left")

    const cells: { formula: string; result: number; percent?: boolean }[] = [
      { formula: `COUNTIF(${gen})`, result: matching.length },
      { formula: withStatus("COMPLETE"), result: countOf("COMPLETE") },
      { formula: withStatus("PARTIAL"), result: countOf("PARTIAL") },
      { formula: withStatus("PENDING"), result: countOf("PENDING") },
      {
        formula: `IF(B${r}=0,0,ROUND(C${r}/B${r},3))`,
        result: percentOf(countOf("COMPLETE"), matching.length),
        percent: true,
      },
    ]
    cells.forEach((entry, offset) => {
      const cell = sheet.getCell(r, offset + 2)
      cell.value = { formula: entry.formula, result: entry.result }
      if (entry.percent) cell.numFmt = "0.0%"
      styleBodyCell(cell, "center")
    })
  })

  return sheet
}

/** Builds the 2-tab workbook (no download, no I/O). */
export async function buildWorksTrackerWorkbook(
  data: WorksTrackerData
): Promise<Workbook> {
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Miloto Transport Limited"
  workbook.created = data.generatedAt

  addSheet(
    workbook,
    WORKS_TRACKER_SHEET_NAMES[0],
    trackerColumns,
    data.rows,
    (row, cellOf) => {
      const status = cellOf("Tracker Status")
      if (status) applyLook(status, STATUS_LOOK[row.trackerStatus])
      const outcome = cellOf("Closure Outcome")
      const outcomeLook = OUTCOME_LOOK[row.closureOutcome]
      if (outcome && outcomeLook) applyLook(outcome, outcomeLook)
    }
  )
  buildSummarySheet(workbook, data)
  return workbook
}

export type WorksTrackerWorkbookResult = {
  fileName: string
  buffer: ArrayBuffer
}

/** The workbook as `.xlsx` bytes plus its file name. */
export async function buildWorksTrackerWorkbookFile(
  data: WorksTrackerData
): Promise<WorksTrackerWorkbookResult> {
  const workbook = await buildWorksTrackerWorkbook(data)
  return {
    fileName: pttWorksTrackerFileName("xlsx", data.generatedAt),
    buffer: await workbook.xlsx.writeBuffer(),
  }
}
