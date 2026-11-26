import type { jsPDF } from "jspdf"

import {
  EMPTY_CELL,
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
  type StyleSpec,
} from "./report-pdf"
import { ALL_CLEARED_TEXT } from "./report-data"
import {
  describeWorksTrackerFilters,
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

export const PTT_WORKS_TRACKER_TITLE = "Fleet Diagnostic Works Tracker"

/** Column widths, % of the printable width (sums to 100). */
export const WORKS_TRACKER_COLUMN_RATIOS = [8, 6, 10, 9, 9, 13, 11, 34] as const

export const WORKS_TRACKER_PDF_HEADERS = [
  "Fleet No.",
  "Gen",
  "Tracker Status",
  "Before Photo",
  "After Photo",
  "Fault Tally",
  "Closure Outcome",
  "Closing Fault Codes",
] as const

const STATUS_BADGE_FILL: Record<WorksTrackerStatus, Rgb> = {
  COMPLETE: [22, 163, 74],
  PARTIAL: [217, 119, 6],
  PENDING: [100, 116, 139],
}

const OUTCOME_COLOR: Record<WorksTrackerOutcome, Rgb> = {
  "Clean Closure": GREEN_DARK,
  "Residual Faults": RED_DARK,
  "No Progress": RED_DARK,
  "In Workshop": [146, 64, 14],
  "Not Scanned": MUTED,
}

function dateCell(
  doc: jsPDF,
  value: string | null,
  width: number
): RichLine[] {
  return value
    ? wrapLines(doc, value, { font: "normal", size: 7.2, color: INK }, width)
    : wrapLines(doc, EMPTY_CELL, { font: "normal", size: 7.2, color: MUTED }, width)
}

/** `Open X | Clr Y | Close Z` (+ red `Reg N`), `Open X`, or an em dash. */
function tallyCell(
  doc: jsPDF,
  row: WorksTrackerRow,
  width: number
): RichLine[] {
  if (row.trackerStatus === "PENDING") {
    return wrapLines(doc, EMPTY_CELL, { font: "normal", size: 7.2, color: MUTED }, width)
  }
  if (row.trackerStatus === "PARTIAL") {
    return wrapLines(
      doc,
      `Open ${row.openingFaultsCount ?? 0}`,
      { font: "normal", size: 7, color: INK },
      width
    )
  }
  const lines = wrapLines(
    doc,
    `Open ${row.openingFaultsCount ?? 0} | Clr ${row.clearedFaultsCount ?? 0} | Close ${row.closingFaultsCount ?? 0}`,
    { font: "normal", size: 7, color: INK },
    width
  )
  const regressions = row.newRegressionsCount ?? 0
  if (regressions > 0) {
    lines.push(
      ...wrapLines(
        doc,
        `Reg ${regressions}`,
        {
          font: "bold",
          size: 6.4,
          color: [255, 255, 255],
          bg: [220, 38, 38],
          badge: true,
          inset: 1.3,
          padTop: 0.6,
          padBottom: 0.6,
          gapBefore: 1.4,
        },
        width
      )
    )
  }
  return lines
}

function closingCell(
  doc: jsPDF,
  row: WorksTrackerRow,
  width: number
): RichLine[] {
  if (row.trackerStatus !== "COMPLETE") {
    return mutedLine(doc, row.closingFaultCodes, width)
  }

  const lines: RichLine[] = []
  if (row.closingFaultsCount === 0) {
    lines.push(
      ...wrapLines(
        doc,
        ALL_CLEARED_TEXT,
        { font: "bold", size: 6.8, color: GREEN_DARK },
        width
      )
    )
  }
  row.closingFaults.forEach((fault, index) => {
    const style: Partial<StyleSpec> = fault.isNewRegression
      ? {
          font: "bold",
          color: RED_DARK,
          bg: [254, 226, 226],
          accent: [220, 38, 38],
          inset: 1.2,
          padTop: 0.5,
          padBottom: 0.5,
        }
      : fault.isApprovedException
        ? { color: MUTED }
        : fault.repeatCount >= 1
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
        fault.text,
        {
          font: "normal",
          size: 6.8,
          color: INK,
          indent: 2.8,
          bullet: "\u2022",
          gapBefore: index === 0 && row.closingFaultsCount !== 0 ? 0 : 0.9,
          ...style,
        },
        width
      )
    )
  })
  if (row.approvedExceptionsNote) {
    lines.push(
      ...wrapLines(
        doc,
        row.approvedExceptionsNote,
        { font: "italic", size: 6.2, color: MUTED, gapBefore: 1.8 },
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
    wrapLines(doc, row.fleetId, { font: "bold", size: 8.5, color: [20, 20, 20] }, inner[0]),
    wrapLines(
      doc,
      row.generation,
      {
        font: "bold",
        size: 7,
        color: row.generation === EMPTY_CELL ? MUTED : [71, 85, 105],
      },
      inner[1]
    ),
    wrapLines(
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
      inner[2]
    ),
    dateCell(doc, row.beforePhotoDate, inner[3]),
    dateCell(doc, row.afterPhotoDate, inner[4]),
    tallyCell(doc, row, inner[5]),
    wrapLines(
      doc,
      row.closureOutcome,
      { font: "bold", size: 7, color: OUTCOME_COLOR[row.closureOutcome] },
      inner[6]
    ),
    closingCell(doc, row, inner[7]),
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
      describeWorksTrackerFilters(options),
      `${kpis.totalFleet} ${kpis.totalFleet === 1 ? "truck" : "trucks"} \u2014 diagnostic sweep progress: Pending (no baseline photo), Partial (before photo only), Complete (before and after photos).`,
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
