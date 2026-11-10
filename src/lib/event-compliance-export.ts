import { exportDataToCSV } from "@/lib/export-image"
import {
  formatWorkshopDate,
  toWorkshopDay,
  type ComplianceStatus,
  type FleetComplianceRow,
} from "@/lib/workshop-events"

export type ClassifiedComplianceRow = FleetComplianceRow & {
  status: ComplianceStatus
}

export const COMPLIANCE_TAB_KEYS = [
  "trucks",
  "trailers",
  "mixers",
  "towTrucks",
] as const
export type ComplianceTabKey = (typeof COMPLIANCE_TAB_KEYS)[number]

// Display label used in tab triggers and as the export `tabName`.
export const COMPLIANCE_TAB_LABELS: Record<ComplianceTabKey, string> = {
  trucks: "Trucks (MTL)",
  trailers: "Trailers (MT)",
  mixers: "Mixers (CM)",
  towTrucks: "Tow Trucks",
}

// Short name used in filenames and the PDF title.
export const COMPLIANCE_TAB_EXPORT_NAMES: Record<ComplianceTabKey, string> = {
  trucks: "Trucks",
  trailers: "Trailers",
  mixers: "Mixers",
  towTrucks: "Tow Trucks",
}

export type PartitionedCompliance<T extends { assetName: string }> = Record<
  ComplianceTabKey | "other",
  T[]
>

// Splits rows into fleet groups by asset name. Checks run in a fixed order and
// each row lands in exactly one group:
//   MTL*            -> trucks
//   MT* (not MTL*)  -> trailers
//   CM*             -> mixers
//   *TOW* or TT-*   -> towTrucks
//   anything else   -> other
export function partitionByAssetName<T extends { assetName: string }>(
  rows: T[]
): PartitionedCompliance<T> {
  const result: PartitionedCompliance<T> = {
    trucks: [],
    trailers: [],
    mixers: [],
    towTrucks: [],
    other: [],
  }

  for (const row of rows) {
    const name = row.assetName.trim().toUpperCase()

    if (name.startsWith("MTL")) result.trucks.push(row)
    else if (name.startsWith("MT")) result.trailers.push(row)
    else if (name.startsWith("CM")) result.mixers.push(row)
    else if (name.includes("TOW") || name.startsWith("TT-"))
      result.towTrucks.push(row)
    else result.other.push(row)
  }

  return result
}

function fileSafe(value: string) {
  return value.trim().replace(/\s+/g, "_")
}

export function exportToCSV(data: ClassifiedComplianceRow[], tabName: string) {
  exportDataToCSV(
    data.map((row) => ({
      "Asset Name": row.assetName,
      "Asset Type": row.assetType,
      "Last Event Date": row.lastEventDate
        ? toWorkshopDay(row.lastEventDate)
        : "",
      "Last Event Outcome": row.lastEventOutcome ?? "",
      Status: row.status,
    })),
    `Event_Compliance_${fileSafe(tabName)}.csv`
  )
}

// Red = FAILED, Orange = PENDING, Green = OK.
const PDF_STATUS_COLORS: Record<ComplianceStatus, [number, number, number]> = {
  FAILED: [220, 38, 38],
  PENDING: [234, 124, 8],
  OK: [22, 163, 74],
}

export async function exportToPDF(
  data: ClassifiedComplianceRow[],
  tabName: string,
  filters: { from: string; to: string; category: string }
) {
  // Loaded on demand so the PDF libraries stay out of the initial bundle.
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ])

  const doc = new jsPDF()

  doc.setFontSize(16)
  doc.text(`Miloto Workshop - Event Compliance: ${tabName}`, 14, 18)

  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`Date range: ${filters.from} to ${filters.to}`, 14, 26)
  doc.text(`Event category: ${filters.category}`, 14, 32)
  doc.setTextColor(0)

  autoTable(doc, {
    startY: 38,
    head: [["Asset Name", "Asset Type", "Last Event Date", "Status"]],
    body: data.map((row) => [
      row.assetName,
      row.assetType,
      row.lastEventDate ? formatWorkshopDate(row.lastEventDate) : "-",
      row.status,
    ]),
    headStyles: { fillColor: [39, 39, 42] },
    didParseCell: (hook) => {
      if (hook.section !== "body" || hook.column.index !== 3) return
      const status = hook.cell.raw as ComplianceStatus
      const color = PDF_STATUS_COLORS[status]
      if (color) {
        hook.cell.styles.textColor = color
        hook.cell.styles.fontStyle = "bold"
      }
    },
  })

  doc.save(`Event_Compliance_${fileSafe(tabName)}.pdf`)
}
