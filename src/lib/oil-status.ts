export type OilComplianceStatus = "overdue" | "due_soon" | "compliant"
export type OilComplianceEvent = "service" | "sample"

export type OilMetrics = {
  status: OilComplianceStatus | null
  kmSinceCompliance: number | null
  burnRate: number | null
  lastEvent: OilComplianceEvent | null
}

export type OilHealthRow = {
  assetId: number
  assetName: string
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
}

export function oilComplianceStatusLabel(status: OilComplianceStatus) {
  if (status === "due_soon") return "Due Soon"
  if (status === "overdue") return "Overdue"
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
