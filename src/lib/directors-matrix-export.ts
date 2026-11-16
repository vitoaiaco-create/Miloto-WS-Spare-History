import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

export type MatrixExportColumn = {
  /** Key into each matrix row object. */
  key: string
  /** Header text shown in the PDF. */
  label: string
}

/**
 * A matrix row flattened to display text, keyed by `MatrixExportColumn.key`.
 * Complex cells (icons, dates, pass/fail) must already be reduced to plain
 * strings; multiple entries in one cell are separated by "\n".
 */
export type MatrixExportRow = Record<string, string>

export async function exportMatrixToPDF(
  matrixData: MatrixExportRow[],
  columns: MatrixExportColumn[],
  periodLabel: string
): Promise<void> {
  const doc = new jsPDF({ orientation: "landscape", format: "a1" })

  doc.setFont("helvetica", "bold")
  doc.setFontSize(24)
  doc.text(`Director's Summary Matrix: ${periodLabel}`, 14, 20)

  autoTable(doc, {
    head: [columns.map((column) => column.label)],
    body: matrixData.map((row) => columns.map((column) => row[column.key] ?? "")),
    styles: {
      fontSize: 12,
      cellPadding: 4,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [40, 40, 40],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    margin: { top: 30, left: 14, right: 14 },
  })

  doc.save(
    `Directors_Summary_Matrix_${periodLabel.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`
  )
}
