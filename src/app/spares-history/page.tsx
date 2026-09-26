import { auth } from "@clerk/nextjs/server"
import { ArrowLeft, FileText } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ExportTableMenu } from "@/components/export-table-menu"
import { ShareTableButton } from "@/components/share-table-button"
import { SparesFilterBar } from "@/components/spares-filter-bar"
import { SparesStatementView } from "@/components/spares-statement-view"
import { SparesTable } from "@/components/spares-table"
import { Button } from "@/components/ui/button"
import { formatIsoDate, toIsoDateParam } from "@/lib/iso-date"
import {
  getSparesHistory,
  getStatementAssets,
  hasActiveSparesFilters,
  type SparesHistoryFilters,
} from "@/lib/spares-history"
import {
  isStatementMode,
  parseStatementAssetType,
  parseStatementPeriod,
  statementDateRange,
  sparesStatementHref,
} from "@/lib/spares-statement"
import { normalizeSubEquipment } from "@/lib/spreadsheet"

type SearchParams = { [key: string]: string | string[] | undefined }

function toFilterString(value: string | string[] | undefined) {
  return typeof value === "string" ? value : ""
}

function toFilterList(value: string | string[] | undefined) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : []

  return [
    ...new Set(raw.map((item) => normalizeSubEquipment(item)).filter(Boolean)),
  ]
}

export default async function SparesHistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const allowedModules = sessionClaims?.metadata?.modules || []

  if (!allowedModules.includes("spares_history")) {
    redirect("/")
  }

  const resolvedSearchParams = await searchParams
  const today = formatIsoDate(new Date())
  const statementEnabled = isStatementMode(
    toFilterString(resolvedSearchParams.statement)
  )
  const statementPeriod = parseStatementPeriod(
    toFilterString(resolvedSearchParams.period)
  )
  const statementAssetType = parseStatementAssetType(
    toFilterString(resolvedSearchParams.assetType)
  )
  const statementRange = statementDateRange(statementPeriod, new Date())

  const excludeFrom = toIsoDateParam(
    toFilterString(resolvedSearchParams.excludeFrom)
  )
  const excludeTo = toIsoDateParam(toFilterString(resolvedSearchParams.excludeTo))
  const hasExcludeRange = Boolean(excludeFrom && excludeTo)

  const filters: SparesHistoryFilters = statementEnabled
    ? {
        fleetNo: toFilterString(resolvedSearchParams.fleetNo),
        assetType: statementAssetType,
        startDate: statementRange.startDate,
        endDate: statementRange.endDate,
      }
    : {
        fleetNo: toFilterString(resolvedSearchParams.fleetNo),
        partNumber: toFilterString(resolvedSearchParams.partNumber),
        materialName: toFilterString(resolvedSearchParams.materialName),
        subEquipment: toFilterList(resolvedSearchParams.subEquipment),
        startDate: toFilterString(resolvedSearchParams.startDate),
        endDate: toFilterString(resolvedSearchParams.endDate),
        excludeFrom: hasExcludeRange ? excludeFrom : "",
        excludeTo: hasExcludeRange ? excludeTo : "",
      }

  const [spares, statementAssets] = await Promise.all([
    getSparesHistory(filters),
    statementEnabled ? getStatementAssets() : Promise.resolve([]),
  ])

  return (
    <main className="flex-1 bg-zinc-50 dark:bg-black">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-16 sm:px-10 lg:px-16">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            nativeButton={false}
            render={<Link href="/" />}
          >
            <ArrowLeft data-icon="inline-start" />
            Central Hub
          </Button>

          {statementEnabled ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/spares-history" />}
            >
              Exit statement
            </Button>
          ) : (
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link
                  href={sparesStatementHref({
                    period: "mtd",
                    assetType: "Truck",
                  })}
                />
              }
            >
              <FileText data-icon="inline-start" />
              Generate Executive Statement
            </Button>
          )}
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
          {statementEnabled ? "Executive Spare Statement" : "Spares History"}
        </h1>

        {statementEnabled ? (
          <SparesStatementView
            key={`${statementPeriod}-${statementAssetType}-${filters.fleetNo ?? ""}`}
            spares={spares}
            period={statementPeriod}
            startDate={statementRange.startDate}
            endDate={statementRange.endDate}
            assetType={statementAssetType}
            fleetNo={filters.fleetNo ?? ""}
            assets={statementAssets}
            today={today}
          />
        ) : (
          <>
            <SparesFilterBar initialFilters={filters} />

            <div className="flex items-center justify-end gap-2">
              <ExportTableMenu spares={spares} filters={filters} />
              <ShareTableButton spares={spares} filters={filters} />
            </div>

            <SparesTable
              spares={spares}
              isFiltered={hasActiveSparesFilters(filters)}
            />
          </>
        )}
      </section>
    </main>
  )
}
