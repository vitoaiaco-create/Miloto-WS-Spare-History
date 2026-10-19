import { classifyStatementAssetType } from "@/lib/spares-statement"

export const AIR_SYSTEM_COMPLIANCE_STATUSES = [
  "Pending",
  "OK",
  "Failed",
] as const
export type AirSystemComplianceStatus =
  (typeof AIR_SYSTEM_COMPLIANCE_STATUSES)[number]

export const AIR_SYSTEM_ASSET_TYPES = ["Horse", "Trailer"] as const
export type AirSystemAssetType = (typeof AIR_SYSTEM_ASSET_TYPES)[number]

export type AirSystemResponseSpare = {
  materialName: string
  quantity: number
}

export type AirSystemComplianceRow = {
  assetId: number
  assetName: string
  assetType: AirSystemAssetType
  status: AirSystemComplianceStatus
  dateTested: string | null
  responseSpares: AirSystemResponseSpare[]
}

const STATUS_SORT_RANK: Record<AirSystemComplianceStatus, number> = {
  Failed: 0,
  Pending: 1,
  OK: 2,
}

// Prime movers / trucks are "horses" in the yard. Cranes stay off this
// roster — they are classified as Truck on the executive statement but
// are not air-brake horses or trailers.
export function classifyAirSystemAssetType(
  assetType: string,
  assetName: string
): AirSystemAssetType | null {
  const classified = classifyStatementAssetType(assetType, assetName)
  if (classified === "Trailer") return "Trailer"
  if (classified !== "Truck") return null

  const type = assetType.trim().toLowerCase()
  const name = assetName.trim().toUpperCase()
  if (type === "crane" || /^CM\d+$/.test(name)) return null

  return "Horse"
}

export function compareAirSystemRows(
  left: AirSystemComplianceRow,
  right: AirSystemComplianceRow
) {
  const typeDiff = left.assetType.localeCompare(right.assetType)
  if (typeDiff !== 0) return typeDiff

  const nameDiff = left.assetName.localeCompare(right.assetName, undefined, {
    numeric: true,
  })
  if (nameDiff !== 0) return nameDiff

  return STATUS_SORT_RANK[left.status] - STATUS_SORT_RANK[right.status]
}
