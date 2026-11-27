import type { jsPDF } from "jspdf"

import {
  GREEN_DARK,
  INK,
  MUTED,
  RED_DARK,
  drawFooters,
  drawHeaderBlock,
  drawKpiStrip,
  drawRichTable,
  highlightedKpi,
  mutedLine,
  newDoc,
  wrapLines,
  type PttPdfResult,
  type Rgb,
  type RichLine,
} from "./report-pdf"
import {
  NONE_CLEARED_TRACKER_TEXT,
  NONE_RESIDUAL_TRACKER_TEXT,
  describeWorksTrackerFilters,
  describeWorksTrackerOrder,
  pttWorksTrackerFileName,
  type WorksTrackerData,
  type WorksTrackerOutcome,
  type WorksTrackerRow,
  type WorksTrackerStatus,
} from "./works-tracker-data"

// Standalone landscape PDF of the Fleet Diagnostic Works Tracker. Same
// branding and the same purpose-built rich-table renderer as the Executive
// Directives PDF (`drawRichTable`: tall rows split across pages with
// `(cont.)`, header repeated on every page, standard confidential footer).
// Six columns: Cleared and Residual faults sit side by side, ASCII hyphens only.

export const PTT_WORKS_TRACKER_TITLE = "Fleet Diagnostic Works Tracker"

/** Column widths, % of the printable width (sums to 100). */
export const WORKS_TRACKER_COLUMN_RATIOS = [8, 13, 11, 10, 29, 29] as const

export const WORKS_TRACKER_PDF_HEADERS = [
  "Fleet & Gen",
  "Status & Outcome",
  "Before / After",
  "Fault Tally",
  "Cleared Faults",
  "Residual Faults",
] as const

/** Muted placeholder for a cell with nothing to show. */
const DASH = "-"

const STATUS_BADGE_FILL: Record<WorksTrackerStatus, Rgb> = {
  COMPLETE: [22, 163, 74],
  PARTIAL: [217, 119, 6],
  PENDING: [100, 116, 139],
}

const OUTCOME_COLOR: Record<WorksTrackerOutcome, Rgb> = {
  "Clean Closure": GREEN_DARK,
  "Closed (Accepted Residuals)": [15, 118, 110],
  "Residual Faults": RED_DARK,
  "No Progress": RED_DARK,
  "Fault Clearance Pending": [146, 64, 14],
  "Not Scanned": MUTED,
}

const INK_STYLE = { font: "normal", size: 7, color: INK } as const

function fleetCell(doc: jsPDF, row: WorksTrackerRow, width: number): RichLine[] {
  const known = row.generation !== "\u2014"
  return [
    ...wrapLines(
      doc,
      row.fleetId,
      { font: "bold", size: 8.5, color: [20, 20, 20] },
      width
    ),
    ...wrapLines(
      doc,
      known ? row.generation : DASH,
      { font: "normal", size: 6.4, color: MUTED, gapBefore: 0.4 },
      width
    ),
  ]
}

/** Status pill stacked above the closure outcome label. */
function statusCell(doc: jsPDF, row: WorksTrackerRow, width: number): RichLine[] {
  return [
    ...wrapLines(
      doc,
      row.trackerStatus,
      {
        font: "bold",
        size: 6.4,
        color: [255, 255, 255],
        bg: STATUS_BADGE_FILL[row.trackerStatus],
        badge: true,
        inset: 1.3,
        padTop: 0.7,
        padBottom: 0.7,
      },
      width
    ),
    ...wrapLines(
      doc,
      row.closureOutcome,
      {
        font: "bold",
        size: 6.8,
        color: OUTCOME_COLOR[row.closureOutcome],
        gapBefore: 1.4,
      },
      width
    ),
  ]
}

/** `Before: <date>` / `After: <date or ->`, or a muted dash when PENDING. */
function datesCell(doc: jsPDF, row: WorksTrackerRow, width: number): RichLine[] {
  if (row.trackerStatus === "PENDING" || !row.beforePhotoDate) {
    return mutedLine(doc, DASH, width)
  }
  return [
    ...wrapLines(doc, `Before: ${row.beforePhotoDate}`, INK_STYLE, width),
    ...wrapLines(
      doc,
      `After: ${row.afterPhotoDate ?? DASH}`,
      { ...INK_STYLE, gapBefore: 0.6 },
      width
    ),
  ]
}

/** Stacked `Before: X` / `Cleared: Y` / `Residual: Z` (never a regression count). */
function tallyCell(doc: jsPDF, row: WorksTrackerRow, width: number): RichLine[] {
  if (row.trackerStatus === "PENDING") return mutedLine(doc, DASH, width)
  const entries = [`Before: ${row.openingFaultsCount ?? 0}`]
  if (row.trackerStatus === "COMPLETE") {
    entries.push(
      `Cleared: ${row.clearedFaultsCount ?? 0}`,
      `Residual: ${row.residualFaultsCount ?? 0}`
    )
  }
  return entries.flatMap((entry, index) =>
    wrapLines(
      doc,
      entry,
      { ...INK_STYLE, gapBefore: index === 0 ? 0 : 0.6 },
      width
    )
  )
}

function bulletLines(
  doc: jsPDF,
  items: readonly { text: string }[],
  color: Rgb,
  width: number
): RichLine[] {
  return items.flatMap((item, index) =>
    wrapLines(
      doc,
      item.text,
      {
        font: "normal",
        size: 6.8,
        color,
        indent: 2.8,
        bullet: "\u2022",
        gapBefore: index === 0 ? 0 : 0.9,
      },
      width
    )
  )
}

function clearedCell(doc: jsPDF, row: WorksTrackerRow, width: number): RichLine[] {
  if (row.trackerStatus !== "COMPLETE") return mutedLine(doc, DASH, width)
  if (row.clearedFaultItems.length === 0) {
    return mutedLine(doc, NONE_CLEARED_TRACKER_TEXT, width)
  }
  return bulletLines(doc, row.clearedFaultItems, GREEN_DARK, width)
}

function residualCell(doc: jsPDF, row: WorksTrackerRow, width: number): RichLine[] {
  if (row.trackerStatus !== "COMPLETE") {
    return mutedLine(doc, row.residualFaultCodes, width)
  }

  const lines: RichLine[] =
    row.residualFaultItems.length === 0
      ? wrapLines(
          doc,
          NONE_RESIDUAL_TRACKER_TEXT,
          { font: "bold", size: 6.8, color: GREEN_DARK },
          width
        )
      : bulletLines(doc, row.residualFaultItems, INK, width)

  // `Note: <Reason Label> - <Closure Note>` (the data layer already joined the
  // two with an ASCII hyphen), a single muted italic footer.
  if (row.closureNote) {
    lines.push(
      ...wrapLines(
        doc,
        `Note: ${row.closureNote}`,
        { font: "italic", size: 6.2, color: MUTED, gapBefore: 1.4 },
        width
      )
    )
  }
  return lines
}

function rowCells(
  doc: jsPDF,
  row: WorksTrackerRow,
  inner: readonly number[]
): RichLine[][] {
  return [
    fleetCell(doc, row, inner[0]),
    statusCell(doc, row, inner[1]),
    datesCell(doc, row, inner[2]),
    tallyCell(doc, row, inner[3]),
    clearedCell(doc, row, inner[4]),
    residualCell(doc, row, inner[5]),
  ]
}

export function buildWorksTrackerPdf(data: WorksTrackerData): PttPdfResult {
  const title = PTT_WORKS_TRACKER_TITLE
  const doc = newDoc(title)
  const { kpis, rows, options } = data

  const subtitleY = drawHeaderBlock(
    doc,
    title,
    [
      `${describeWorksTrackerFilters(options)}  |  ${describeWorksTrackerOrder(data)}`.replace(/\u2013/g, "-"),
      `${kpis.totalFleet} ${kpis.totalFleet === 1 ? "truck" : "trucks"} - diagnostic sweep progress. Pending (no baseline photo), Partial (before photo only), Complete (before and after photos).`,
    ],
    data.generatedAt
  )

  const kpiBottom = drawKpiStrip(doc, subtitleY + 5, [
    { label: "Total Fleet", value: String(kpis.totalFleet) },
    {
      ...highlightedKpi("Complete", kpis.completeCount, "GREEN"),
      value: `${kpis.completeCount} / ${kpis.completePct}%`,
    },
    highlightedKpi("Partial (Before Only)", kpis.partialCount, "MONITOR"),
    { label: "Pending (No Photos)", value: String(kpis.pendingCount) },
    highlightedKpi("Clean Closures", kpis.cleanClosureCount, "GREEN"),
    {
      label: "Closed (Accepted Residuals)",
      value: String(kpis.closedAcceptedResidualsCount),
    },
    highlightedKpi(
      "Complete w/ Residual Faults",
      kpis.residualFaultsTrucksCount,
      "CRITICAL"
    ),
  ])

  drawRichTable(doc, {
    title,
    headers: WORKS_TRACKER_PDF_HEADERS,
    ratios: WORKS_TRACKER_COLUMN_RATIOS,
    startY: kpiBottom + 6,
    rows,
    buildCells: (row, inner) => rowCells(doc, row, inner),
    continuationLabel: (row) => `${row.fleetId} (cont.)`,
    emptyMessage: "No trucks match the selected filters.",
  })

  drawFooters(doc, data.generatedAt)
  return {
    fileName: pttWorksTrackerFileName("pdf", data.generatedAt),
    title,
    buffer: doc.output("arraybuffer"),
    pageCount: doc.getNumberOfPages(),
  }
}
