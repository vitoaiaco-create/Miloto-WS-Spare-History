// Local copies of the scorecard unions so this module can be imported from
// Client Components without pulling in `logistics-scoring.ts` (`server-only`).
type MatrixClass = "Class A" | "Class B" | "Class C" | "Class D"
export type ScorecardClass = MatrixClass | "N/A"

export type AssetRankingsExportMonth = {
  month: number
  netScore: number
  trailerName?: string
  trailersPulled?: string
}

export type AssetRankingsExportRow = {
  displayName: string
  averageMonthlyScore: number
  currentClass: MatrixClass
  distanceClass: ScorecardClass
  safetyClass: ScorecardClass
  truckPenaltyClass: ScorecardClass
  trailerPenaltyClass: ScorecardClass
  tyrePenaltyClass: ScorecardClass
  suspensionPenaltyClass: ScorecardClass
  monthlyData: AssetRankingsExportMonth[]
}

export type AssetRankingsMonthColumn = { month: number; label: string }

export type ScorecardPdfRgb = [number, number, number]

export type AssetRankingsPdfCell = {
  content: string
  styles: {
    fillColor: ScorecardPdfRgb
    textColor: ScorecardPdfRgb
    fontStyle: "bold"
    halign: "center"
  }
}

export type AssetRankingsExportField = {
  header: string
  value: (row: AssetRankingsExportRow) => string
  pdf: (row: AssetRankingsExportRow) => string | AssetRankingsPdfCell
}

// Same green/blue/orange/red letter-grade palette as the on-screen scorecard
// (`ScorecardCell` in logistics-dashboard). Tailwind tokens for HTML; RGB
// tuples for jsPDF AutoTable, which cannot keep CSS backgrounds.
export const SCORECARD_CLASS_STYLES: Record<ScorecardClass, string> = {
  "Class A": "bg-green-600 text-white",
  "Class B": "bg-blue-600 text-white",
  "Class C": "bg-orange-500 text-white",
  "Class D": "bg-red-600 text-white",
  "N/A": "bg-muted text-muted-foreground",
}

export const SCORECARD_CLASS_PDF_COLORS: Record<
  ScorecardClass,
  { fillColor: ScorecardPdfRgb; textColor: ScorecardPdfRgb }
> = {
  "Class A": { fillColor: [22, 163, 74], textColor: [255, 255, 255] },
  "Class B": { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
  "Class C": { fillColor: [249, 115, 22], textColor: [255, 255, 255] },
  "Class D": { fillColor: [220, 38, 38], textColor: [255, 255, 255] },
  "N/A": { fillColor: [247, 247, 247], textColor: [113, 113, 122] },
}

export function getScorecardClassColor(value: ScorecardClass) {
  return SCORECARD_CLASS_STYLES[value]
}

function isScorecardClass(value: string): value is ScorecardClass {
  return Object.prototype.hasOwnProperty.call(SCORECARD_CLASS_PDF_COLORS, value)
}

export function scorecardPdfCell(value: string): AssetRankingsPdfCell | string {
  if (!isScorecardClass(value)) return value

  const colors = SCORECARD_CLASS_PDF_COLORS[value]
  return {
    content: value,
    styles: {
      fillColor: colors.fillColor,
      textColor: colors.textColor,
      fontStyle: "bold",
      halign: "center",
    },
  }
}

function exportField(
  header: string,
  value: (row: AssetRankingsExportRow) => string,
  scorecard = false
): AssetRankingsExportField {
  return {
    header,
    value,
    pdf: scorecard ? (row) => scorecardPdfCell(value(row)) : value,
  }
}

export const MISSING_COUPLED_TRAILER = "—"

function formatPoints(points: number) {
  const formatted = points.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return points > 0 ? `+${formatted}` : formatted
}

function formatAverageScore(points: number) {
  const formatted = points.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  return points > 0 ? `+${formatted}` : formatted
}

function monthNetScore(
  monthlyData: Array<{ month: number; netScore: number }>,
  month: number
) {
  const row = monthlyData.find((entry) => entry.month === month)
  return row ? formatPoints(row.netScore) : "-"
}

export function latestAvailableMonth(
  rows: Array<{ monthlyData: Array<{ month: number }> }>,
  ytdMonths: AssetRankingsMonthColumn[]
) {
  const latestInRows = rows.reduce(
    (latest, row) =>
      row.monthlyData.reduce(
        (inner, entry) => Math.max(inner, entry.month),
        latest
      ),
    0
  )

  return latestInRows || ytdMonths.at(-1)?.month || 0
}

// Same source the expanded Motive Unit / Operator rows use: `trailerName`
// for a truck pairing, `trailersPulled` for a driver. Empty string is a
// bobtail month (or no pairing recorded).
export function coupledTrailerForMonth(
  monthlyData: AssetRankingsExportMonth[],
  month: number
) {
  const latest = monthlyData.find((entry) => entry.month === month)
  if (!latest) return MISSING_COUPLED_TRAILER

  const trailerName = latest.trailerName?.trim() ?? ""
  const trailersPulled = latest.trailersPulled?.trim() ?? ""
  return trailerName || trailersPulled || MISSING_COUPLED_TRAILER
}

export function buildAssetRankingsExportColumns(
  rows: AssetRankingsExportRow[],
  ytdMonths: AssetRankingsMonthColumn[]
): AssetRankingsExportField[] {
  const latestMonth = latestAvailableMonth(rows, ytdMonths)

  return [
    exportField("Entity Name", (row) => row.displayName),
    exportField("Coupled Trailer", (row) =>
      coupledTrailerForMonth(row.monthlyData, latestMonth)
    ),
    ...ytdMonths.map((column) =>
      exportField(column.label, (row) =>
        monthNetScore(row.monthlyData, column.month)
      )
    ),
    exportField("Avg Score", (row) =>
      formatAverageScore(row.averageMonthlyScore)
    ),
    exportField("Dist Class", (row) => row.distanceClass, true),
    exportField("Safety Class", (row) => row.safetyClass, true),
    exportField("Truck Pen.", (row) => row.truckPenaltyClass, true),
    exportField("Trailer Pen.", (row) => row.trailerPenaltyClass, true),
    exportField("Tyre Pen.", (row) => row.tyrePenaltyClass, true),
    exportField("Susp. Pen.", (row) => row.suspensionPenaltyClass, true),
    exportField("Overall Class", (row) => row.currentClass, true),
  ]
}
