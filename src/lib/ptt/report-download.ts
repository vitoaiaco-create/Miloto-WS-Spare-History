import { saveAs } from "file-saver"

import {
  buildPttReportData,
  type PttReportDataOptions,
  type PttReportInput,
  type PttReportKind,
} from "./report-data"
import {
  buildWorksTrackerData,
  type PttWorksTrackerInput,
} from "./works-tracker-data"

// Browser download of the Fleet Diagnostics exports: builds the shared report
// data once, renders the requested file and saves it. The PDF / Excel
// libraries are loaded on demand so they stay out of the initial bundle.

const PDF_MIME = "application/pdf"
const EXCEL_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

export type PttReportDownload = {
  fileName: string
  /** What the file contains, for the success toast. */
  trucks: number
  faultRows: number
}

export async function downloadPttReport(
  kind: PttReportKind,
  input: PttReportInput,
  options: PttReportDataOptions
): Promise<PttReportDownload> {
  const data = buildPttReportData(input, options)

  let fileName: string
  let blob: Blob
  if (kind === "EXCEL") {
    const { buildPttWorkbookFile } = await import("./report-excel")
    const result = await buildPttWorkbookFile(data)
    fileName = result.fileName
    blob = new Blob([result.buffer], { type: EXCEL_MIME })
  } else {
    const { buildFaultReportPdf, buildExecutiveDirectivesPdf } = await import(
      "./report-pdf"
    )
    const result =
      kind === "FAULT_PDF"
        ? buildFaultReportPdf(data)
        : buildExecutiveDirectivesPdf(data)
    fileName = result.fileName
    blob = new Blob([result.buffer], { type: PDF_MIME })
  }

  saveAs(blob, fileName)
  return {
    fileName,
    trucks: data.trucks.length,
    faultRows: data.faultRows.length,
  }
}

export type PttWorksTrackerFormat = "PDF" | "EXCEL"

export type PttWorksTrackerDownload = {
  fileName: string
  /** What the file contains, for the success toast. */
  totalFleet: number
  completeCount: number
  partialCount: number
  pendingCount: number
}

/**
 * Browser download of the Fleet Diagnostic Works Tracker (standalone PDF or
 * Excel workbook). Honours the dialog's Truck, date window and
 * `excludeApprovedExceptions` options; the severity filter never applies.
 */
export async function downloadPttWorksTracker(
  format: PttWorksTrackerFormat,
  input: PttWorksTrackerInput,
  options: PttReportDataOptions
): Promise<PttWorksTrackerDownload> {
  const data = buildWorksTrackerData(input, options)

  let fileName: string
  let blob: Blob
  if (format === "EXCEL") {
    const { buildWorksTrackerWorkbookFile } = await import(
      "./works-tracker-excel"
    )
    const result = await buildWorksTrackerWorkbookFile(data)
    fileName = result.fileName
    blob = new Blob([result.buffer], { type: EXCEL_MIME })
  } else {
    const { buildWorksTrackerPdf } = await import("./works-tracker-pdf")
    const result = buildWorksTrackerPdf(data)
    fileName = result.fileName
    blob = new Blob([result.buffer], { type: PDF_MIME })
  }

  saveAs(blob, fileName)
  return {
    fileName,
    totalFleet: data.kpis.totalFleet,
    completeCount: data.kpis.completeCount,
    partialCount: data.kpis.partialCount,
    pendingCount: data.kpis.pendingCount,
  }
}
