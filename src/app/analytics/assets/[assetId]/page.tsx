import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import {
  getActiveAssets,
  getAssetSubEquipmentCostings,
} from "@/actions/analytics"
import { AssetAnalyticsControls } from "@/components/asset-analytics-controls"
import { AssetCostingsTable } from "@/components/asset-costings-table"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

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

export default async function AnalyticsAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetId: string }>
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

  const { assetId } = await params
  const resolvedSearchParams = await searchParams
  const year = toSelectedYear(resolvedSearchParams.year)
  const month = toSelectedMonth(resolvedSearchParams.month)
  const hasNumericAssetId = /^\d+$/.test(assetId)

  const [assets, costings] = await Promise.all([
    getActiveAssets(year),
    hasNumericAssetId
      ? getAssetSubEquipmentCostings(assetId, year, month)
      : Promise.resolve([]),
  ])

  return (
    <div className="flex flex-col gap-6">
      <AssetAnalyticsControls
        assets={assets}
        assetId={assetId}
        year={year}
        month={month}
      />

      {costings.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sub Equipment Costings</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              No maintenance costings recorded for this period
            </p>
          </CardContent>
        </Card>
      ) : (
        <AssetCostingsTable costings={costings} />
      )}
    </div>
  )
}
