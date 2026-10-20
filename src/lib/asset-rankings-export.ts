// Local copies of the scorecard unions so this module can be imported from
// Client Components without pulling in `logistics-scoring.ts` (`server-only`).
type MatrixClass = "Class A" | "Class B" | "Class C" | "Class D"
type ScorecardClass = MatrixClass | "N/A"

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

export type AssetRankingsExportField = {
  header: string
  value: (row: AssetRankingsExportRow) => string
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
    {
      header: "Entity Name",
      value: (row) => row.displayName,
    },
    {
      header: "Coupled Trailer",
      value: (row) => coupledTrailerForMonth(row.monthlyData, latestMonth),
    },
    ...ytdMonths.map((column) => ({
      header: column.label,
      value: (row: AssetRankingsExportRow) =>
        monthNetScore(row.monthlyData, column.month),
    })),
    {
      header: "Avg Score",
      value: (row) => formatAverageScore(row.averageMonthlyScore),
    },
    {
      header: "Dist Class",
      value: (row) => row.distanceClass,
    },
    {
      header: "Safety Class",
      value: (row) => row.safetyClass,
    },
    {
      header: "Truck Pen.",
      value: (row) => row.truckPenaltyClass,
    },
    {
      header: "Trailer Pen.",
      value: (row) => row.trailerPenaltyClass,
    },
    {
      header: "Tyre Pen.",
      value: (row) => row.tyrePenaltyClass,
    },
    {
      header: "Susp. Pen.",
      value: (row) => row.suspensionPenaltyClass,
    },
    {
      header: "Overall Class",
      value: (row) => row.currentClass,
    },
  ]
}
