import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { getFleetAssetCostings } from "@/actions/analytics"
import {
  fleetTypeFromComparisonFleet,
  parseAssetComparisonFleet,
} from "@/lib/asset-comparison"

import { ClientTable } from "./client-table"

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

export default async function AnalyticsAssetsTablePage({
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
  const fetchedData = await getFleetAssetCostings(
    year,
    fleetTypeFromComparisonFleet(fleet),
    month
  )

  return (
    <ClientTable data={fetchedData} fleet={fleet} year={year} month={month} />
  )
}
