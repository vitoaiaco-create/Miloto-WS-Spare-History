import { jsPDF } from "jspdf"
import autoTable, { type CellDef } from "jspdf-autotable"

// 64x64 transparent PNG icons, drawn onto the PDF next to a cell's date.
const ICON_CHECK_OK_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABwUlEQVR42u2azY2DMBCFKYET55TgEjhzogRKSAnuICX4QAEpISVQgkughOyuxEqraIMYv/EYT+Yw4oCQ/L7E9pufppuH5pOjMQAGwAAYAANgAAyAATAAemL8fvotxk8C0HfzELt5eL5E3N6pBtD/I/w1eq0AXDcP6wEAUSOAo+J/Y9QEoH2z5/fCawHwI34hilcFIEW8mi0QEsWrOARTxau4Bj0gfqrdCE05xNcCABF/qz0XcID4UHs2SHV5f+Neezp8AcQvm1GqFkALGB2S+DMCQMSvVPFHAZAqLGA8APGOuySWVGEp4PKSxe8B6FGDIWhxoX/luxeRw2UdjGsul5cKYBRcBOLyrrnK4j6H5WQATXZ5kgCoi0JcXuA8fEv8Moj4h1RnKIIQ2h2js0q5vNzXIHWxohaXywitTBBQi3sp1Rx1TBDuJVweVy6AQkC+dbkTMMq1FcFzQdzlcafDyD4+pfiUeoAEBH/2CZGcEIJ0EQap3ITaxXOUxLggLDUPSYUMrrG6KbEb0LFtSxZiS7awVgmjI10Wn2oSn6svMKX26jVNikqX1E87KivZVLFZYQNgAAyAATAABsAAGAADQIgvz4tDcufWSg8AAAAASUVORK5CYII="
const ICON_CROSS_FAIL_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABQElEQVR42u2bwQ3DMAhFmcZzZASPwCgeNJJHcXvIqZfaMQHUvgPqoZGAl9qGbypnKfLPJgAAAAAAAAAAAGDF6vuzXVYTJLEVz8rDx1lKP0sZH9av77wTN4lnxdn4YuqYvE7Ec1gC6BMOvSDoZCzdCkCddOgBQRdjqRYA2qLTpyDojThaFABrCHozhhaxBKwh6Ib/6r0JWkPYSb57H4PWEHTT52FdCKkjBDdf3m9Fk4EWCfhpapbkd7rBJwLVgH1Goo6nz4BDkrfQAywCD0veShDZTWBEFlrRpeoIrjJFEtTroX1Gho4ttNOUJG1rWJudRbgIE1okkXoTojJl0e/CdEYAsATYBDkGKYQohWmGaIcRRJDEEEWRxbkY4WqMy1GuxxmQYESGISnG5BiUZFSWYWnG5fnDBAAAAAAAAAAAv28vEMQt4rAmz5YAAAAASUVORK5CYII="
const ICON_SPANNER_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABmElEQVR42u3b3Q2CMBSGYUZgCe4ZoSM4ggkLOAIbMEJH6QiO4ABcMAJKUm9MsKf0h+8czkWjUYx5H/ktsemGubnyaBRAARRAARRAAWBH/3kcu2F23TAv3TCvfiz+te29ViKA8YFrYFhpa8D2a06E8CzxaABb/LNmPBLAKfFIANMZ8SgA5qx4FAB3VjwCQF8hvkUGGAsDWP8dsACu4PZv/WcdMsBCBIhFsD+nzbAAa+SwkfHfIQYghGB3PiNiEwgh7MUvEnaCIQT7ZznH/TAYQrCBZaAPg49EAMroUQHuFeId6qlwjfjVX2jBAdSKnxAvhmrFP6mTpZeOrwlQc7Vv0eYDau3tDeKESGr8g3BjpEedEUqNv3O+NcYivhQAm/gSAKzicwOwi88JwDI+FwDb+BwArONTAdjHpwCIiD8KICb+CICo+FgAcfExACLjqQBi4ykARnI8BeAlOT4EcJMeHwIYpceXAGAVn3sTYBefcyfIMj7XYZBtPPVEyOysCa+jNyO4Xgvc/I5x9M/1LzMKoAAKoAAKwHy8ASblUZGbOlLXAAAAAElFTkSuQmCC"

export type MatrixExportIcon = "OK" | "FAIL" | "Spanner"

const ICON_BASE64: Record<MatrixExportIcon, string> = {
  OK: ICON_CHECK_OK_BASE64,
  FAIL: ICON_CROSS_FAIL_BASE64,
  Spanner: ICON_SPANNER_BASE64,
}

/** Icon edge length in mm (jsPDF "a1" format uses mm units). */
const ICON_SIZE = 3.8
/** Gap between the icon and the text, in mm. */
const ICON_GAP = 1.5
const CELL_PADDING = 4

export type MatrixExportColumn = {
  /** Key into each matrix row object. */
  key: string
  /** Header text shown in the PDF. */
  label: string
}

/** One entry inside a matrix cell (a cell can hold several). */
export type MatrixExportCellLine = {
  /** Raw date text, e.g. "12-Nov". */
  date: string
  /** Icon drawn left of the text. Omit for a text-only line. */
  status?: MatrixExportIcon
  /** Extra text after the date, e.g. "(A2+4.0)". */
  detail?: string
  /** Text before the date, used when there is no icon to convey the type. */
  label?: string
}

/** A cell is either plain text or a list of icon-annotated lines. */
export type MatrixExportCell = string | MatrixExportCellLine[]

/**
 * A matrix row keyed by `MatrixExportColumn.key`. Text columns (e.g. the asset
 * name) stay plain strings; event columns carry structured lines so the
 * exporter can draw an icon next to each date.
 */
export type MatrixExportRow = Record<string, MatrixExportCell>

/** Autotable cell definition carrying our structured lines through `cell.raw`. */
type IconCellDef = CellDef & { lines: MatrixExportCellLine[] }

function lineText(line: MatrixExportCellLine) {
  return [line.label, line.date, line.detail].filter(Boolean).join(" ")
}

function toCellInput(cell: MatrixExportCell | undefined): string | IconCellDef {
  if (cell === undefined) return ""
  if (typeof cell === "string") return cell
  return { content: cell.map(lineText).join("\n"), lines: cell }
}

function getIconLines(raw: unknown): MatrixExportCellLine[] | null {
  if (typeof raw !== "object" || raw === null || !("lines" in raw)) return null
  const lines = (raw as IconCellDef).lines
  if (!Array.isArray(lines) || !lines.some((line) => line.status)) return null
  return lines
}

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
    body: matrixData.map((row) =>
      columns.map((column) => toCellInput(row[column.key]))
    ),
    styles: {
      fontSize: 12,
      cellPadding: CELL_PADDING,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [40, 40, 40],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    margin: { top: 30, left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section !== "body" || !getIconLines(data.cell.raw)) return
      // Reserve room on the left so text starts after the icon.
      data.cell.styles.cellPadding = {
        top: CELL_PADDING,
        right: CELL_PADDING,
        bottom: CELL_PADDING,
        left: CELL_PADDING + ICON_SIZE + ICON_GAP,
      }
    },
    didDrawCell: (data) => {
      if (data.section !== "body") return
      const lines = getIconLines(data.cell.raw)
      if (!lines) return

      const { cell } = data
      const lineHeight =
        (cell.styles.fontSize * doc.getLineHeightFactor()) /
        doc.internal.scaleFactor
      const textWidth = cell.width - cell.padding("horizontal")

      // Measure wrapped line counts with the cell's font so each icon lines
      // up with the first row of its own entry.
      doc.setFont(cell.styles.font, cell.styles.fontStyle)
      doc.setFontSize(cell.styles.fontSize)

      let rowIndex = 0
      for (const line of lines) {
        if (line.status) {
          const y =
            cell.y +
            cell.padding("top") +
            rowIndex * lineHeight +
            (lineHeight - ICON_SIZE) / 2
          doc.addImage(
            ICON_BASE64[line.status],
            "PNG",
            cell.x + CELL_PADDING,
            y,
            ICON_SIZE,
            ICON_SIZE
          )
        }
        rowIndex += (doc.splitTextToSize(lineText(line), textWidth) as string[])
          .length
      }
    },
  })

  doc.save(
    `Directors_Summary_Matrix_${periodLabel.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`
  )
}
