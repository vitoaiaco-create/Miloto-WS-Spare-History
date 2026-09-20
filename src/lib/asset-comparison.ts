import type {
  FleetAssetCosting,
  FleetAssetCostingsFleetType,
} from "@/actions/analytics"

export type AssetComparisonFleet = "trucks" | "trailers"

export const ASSET_COMPARISON_VIEWS = [
  "top20",
  "1-40",
  "41-80",
  "81-120",
  "121+",
] as const

export type AssetComparisonView = (typeof ASSET_COMPARISON_VIEWS)[number]

export const STANDARD_SUB_EQUIPMENT = [
  "ENGINE",
  "TRANSMISSION",
  "AXLES",
  "DIFFS",
  "SUSPENSION",
  "AIR SYSTEM",
  "ELECTRICAL",
  "HYDRAULIC SYSTEM",
  "CABIN",
  "CHASSIS",
  "BODY",
  "AIRCON",
  "COMPRESSOR",
  "SERVICE",
] as const

export type StandardSubEquipment = (typeof STANDARD_SUB_EQUIPMENT)[number]

export const ASSET_COMPARISON_MONTH_OPTIONS = [
  { value: "ytd", label: "Full Year YTD" },
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
] as const

export function parseAssetComparisonFleet(
  value: string
): AssetComparisonFleet {
  return value === "trailers" ? "trailers" : "trucks"
}

export function fleetTypeFromComparisonFleet(
  fleet: AssetComparisonFleet
): FleetAssetCostingsFleetType {
  return fleet === "trailers" ? "Towed" : "Motive"
}

export function parseAssetComparisonView(value: string): AssetComparisonView {
  return ASSET_COMPARISON_VIEWS.includes(value as AssetComparisonView)
    ? (value as AssetComparisonView)
    : "top20"
}

export function cohortOptions(fleet: AssetComparisonFleet) {
  if (fleet === "trucks") {
    return [
      { value: "top20", label: "Top 20 Spenders" },
      { value: "1-40", label: "MTL01 - MTL40" },
      { value: "41-80", label: "MTL41 - MTL80" },
      { value: "81-120", label: "MTL81 - MTL120" },
      { value: "121+", label: "MTL121+" },
    ] as const
  }

  return [
    { value: "top20", label: "Top 20 Spenders" },
    { value: "1-40", label: "MT01 - MT40" },
    { value: "41-80", label: "MT41 - MT80" },
    { value: "81-120", label: "MT81 - MT120" },
    { value: "121+", label: "MT121+" },
  ] as const
}

export function isStandardSubEquipment(
  value: string
): value is StandardSubEquipment {
  return (STANDARD_SUB_EQUIPMENT as readonly string[]).includes(value)
}

export function masterCostingsCategoryColumns(
  assets: FleetAssetCosting[]
): string[] {
  const extraTotals = new Map<string, number>()

  for (const asset of assets) {
    for (const [category, totalUsd] of Object.entries(asset.subEquipmentSpend)) {
      if (!isStandardSubEquipment(category)) {
        extraTotals.set(
          category,
          (extraTotals.get(category) ?? 0) + totalUsd
        )
      }
    }
  }

  const extras = [...extraTotals.entries()]
    .sort(
      (left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0])
    )
    .map(([category]) => category)

  return [...STANDARD_SUB_EQUIPMENT, ...extras]
}

export function assetComparisonSearchString({
  fleet,
  view,
  year,
  month,
}: {
  fleet: AssetComparisonFleet
  view?: AssetComparisonView
  year: number
  month?: number
}) {
  const params = new URLSearchParams()
  const currentYear = new Date().getFullYear()

  if (fleet !== "trucks") params.set("fleet", fleet)
  if (view !== undefined && view !== "top20") params.set("view", view)
  if (year !== currentYear) params.set("year", String(year))
  if (month !== undefined) params.set("month", String(month))

  const query = params.toString()
  return query ? `?${query}` : ""
}

export function assetDetailSearchString(year: number, month?: number) {
  const params = new URLSearchParams()
  const currentYear = new Date().getFullYear()

  if (year !== currentYear) params.set("year", String(year))
  if (month !== undefined) params.set("month", String(month))

  const query = params.toString()
  return query ? `?${query}` : ""
}

function fleetUnitNumber(
  assetId: string,
  fleet: AssetComparisonFleet
): number | null {
  const match =
    fleet === "trucks"
      ? assetId.match(/^MTL(\d+)$/)
      : assetId.match(/^MT(\d+)$/)

  if (!match) return null

  return Number(match[1])
}

function unitNumberInView(unitNumber: number, view: AssetComparisonView) {
  if (view === "1-40") return unitNumber >= 1 && unitNumber <= 40
  if (view === "41-80") return unitNumber >= 41 && unitNumber <= 80
  if (view === "81-120") return unitNumber >= 81 && unitNumber <= 120
  if (view === "121+") return unitNumber >= 121
  return false
}

export function filterAssetsForView(
  assets: FleetAssetCosting[],
  fleet: AssetComparisonFleet,
  view: AssetComparisonView
): FleetAssetCosting[] {
  if (view === "top20") {
    return [...assets]
      .sort(
        (left, right) =>
          right.totalUsd - left.totalUsd ||
          left.assetId.localeCompare(right.assetId)
      )
      .slice(0, 20)
  }

  return assets
    .flatMap((asset) => {
      const unitNumber = fleetUnitNumber(asset.assetId, fleet)
      if (unitNumber === null || !unitNumberInView(unitNumber, view)) {
        return []
      }

      return [{ asset, unitNumber }]
    })
    .sort((left, right) => left.unitNumber - right.unitNumber)
    .map(({ asset }) => asset)
}
