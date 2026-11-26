import { saveAs } from "file-saver"

import {
  buildPttReportData,
  type PttReportDataOptions,
  type PttReportInput,
  type PttReportKind,
} from "./report-data"

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
