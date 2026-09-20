import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { getActiveAssets, getFleetAssetCostings } from "@/actions/analytics"
import { AssetComparisonCharts } from "@/components/asset-comparison-charts"
import { AssetComparisonControls } from "@/components/asset-comparison-controls"
import {
  assetDetailSearchString,
  filterAssetsForView,
  fleetTypeFromComparisonFleet,
  parseAssetComparisonFleet,
  parseAssetComparisonView,
} from "@/lib/asset-comparison"

type SearchParams = { [key: string]: string | string[] | undefined }

function toSearchString(value: string | string[] | undefined) {
  return typeof value === "string" ? value : ""
}

function toSelectedYear(value: string | string[] | undefined) {
  const raw = toSearchString(value)
  const year = Number(raw)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return new Date().getFullYear()
  }
  return year
}

function toSelectedMonth(value: string | string[] | undefined) {
  const raw = toSearchString(value)
  const month = Number(raw)
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return undefined
  }
  return month
}

export default async function AnalyticsAssetsIndexPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const role = sessionClaims?.metadata?.role
  const isAdmin = role === "admin"
  const hasAnalyticsModule =
    sessionClaims?.metadata?.modules?.includes("workshop_analytics") ?? false

  if (role === "oils_only" || (!isAdmin && !hasAnalyticsModule)) {
    redirect("/")
  }

  const resolvedSearchParams = await searchParams
  const year = toSelectedYear(resolvedSearchParams.year)
  const month = toSelectedMonth(resolvedSearchParams.month)
  const fleet = parseAssetComparisonFleet(
    toSearchString(resolvedSearchParams.fleet)
  )
  const view = parseAssetComparisonView(
    toSearchString(resolvedSearchParams.view)
  )
  const [costings, activeAssets] = await Promise.all([
    getFleetAssetCostings(
      year,
      fleetTypeFromComparisonFleet(fleet),
      month
    ),
    getActiveAssets(year),
  ])
  const assets = filterAssetsForView(costings.assets, fleet, view).map(
    (asset) => ({
      ...asset,
      href: `/analytics/assets/${encodeURIComponent(asset.assetId)}${assetDetailSearchString(
        year,
        month
      )}`,
    })
  )

  return (
    <div className="flex flex-col gap-6">
      <AssetComparisonControls
        assets={activeAssets}
        fleet={fleet}
        view={view}
        year={year}
        month={month}
      />
      <AssetComparisonCharts
        assets={assets}
        fleetOverallAverage={costings.fleetOverallAverage}
        subEquipmentAverages={costings.subEquipmentAverages}
      />
    </div>
  )
}
