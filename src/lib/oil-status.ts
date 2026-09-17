export type OilComplianceStatus =
  | "overdue"
  | "due_soon"
  | "compliant"
  | "unknown"
export type OilComplianceEvent = "service" | "sample"

// Liters per 1,000 km. At or above this, the Oils & Servicing dashboard
// treats the unit as a critical burner.
export const CRITICAL_BURN_RATE = 3.0

// Full-service interval in kilometres. Anything beyond this since the last
// compliance event is overdue; `overdueKilometers` is the surplus.
export const CRITICAL_SERVICE_INTERVAL = 15_000

export type OilMetrics = {
  status: OilComplianceStatus | null
  kmSinceCompliance: number | null
  overdueKilometers: number
  totalTopUpLiters: number
  burnRate: number | null
  lastEvent: OilComplianceEvent | null
  currentKm: number | null
  oilRunningKm: number | null
}

export type OilHealthRow = {
  assetId: number
  assetName: string
  // True while a sample is requested, drawn, or sent — hides a duplicate
  // "Request Sample" action until that card leaves the active pipeline.
  hasActiveSample: boolean
} & OilMetrics

export type FleetOilStatusCounts = {
  overdue: number
  dueSoon: number
  compliant: number
}

const STATUS_PRIORITY: Record<OilComplianceStatus, number> = {
  overdue: 0,
  due_soon: 1,
  compliant: 2,
  unknown: 3,
}

export function oilComplianceStatusLabel(status: OilComplianceStatus) {
  if (status === "due_soon") return "Due Soon"
  if (status === "overdue") return "Overdue"
  if (status === "unknown") return "Needs Baseline"
  return "Compliant"
}

export function sortOilHealthByPriority(rows: OilHealthRow[]): OilHealthRow[] {
  return [...rows].sort((a, b) => {
    const aRank = a.status ? STATUS_PRIORITY[a.status] : 3
    const bRank = b.status ? STATUS_PRIORITY[b.status] : 3
    if (aRank !== bRank) return aRank - bRank
    return a.assetName.localeCompare(b.assetName)
  })
}

export function countFleetOilStatus(rows: OilHealthRow[]): FleetOilStatusCounts {
  const counts: FleetOilStatusCounts = {
    overdue: 0,
    dueSoon: 0,
    compliant: 0,
  }

  for (const row of rows) {
    if (row.status === "overdue") counts.overdue += 1
    else if (row.status === "due_soon") counts.dueSoon += 1
    else if (row.status === "compliant") counts.compliant += 1
  }

  return counts
}
