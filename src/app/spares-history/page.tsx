import { auth } from "@clerk/nextjs/server"
import { ArrowLeft, FileText } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AlignmentsUploadButton } from "@/components/alignments-upload-button"
import { DirectorSummaryMatrix } from "@/components/director-summary-matrix"
import { ExportTableMenu } from "@/components/export-table-menu"
import { ShareTableButton } from "@/components/share-table-button"
import { SparesFilterBar } from "@/components/spares-filter-bar"
import { SparesHistoryTabs } from "@/components/spares-history-tabs"
import { SparesStatementView } from "@/components/spares-statement-view"
import { SparesTable } from "@/components/spares-table"
import { Button } from "@/components/ui/button"
import {
  formatAnalyticsPeriod,
  isAnalyticsPeriodParam,
  parseAnalyticsPeriod,
} from "@/lib/analytics-period"
import { getDirectorSummaryMatrix } from "@/lib/director-summary-matrix-data"
import { formatIsoDate, toIsoDateParam } from "@/lib/iso-date"
import { cn } from "@/lib/utils"
import {
  getDistinctSubEquipmentValues,
  getPartDescriptionAliases,
  getSparesHistory,
  getStatementAssets,
  getStatementManualEvents,
  hasActiveSparesFilters,
  type SparesHistoryFilters,
} from "@/lib/spares-history"
import {
  isStatementMode,
  parseStatementAssetIds,
  parseStatementAssetScope,
  parseStatementPeriod,
  statementDateRange,
  sparesStatementHref,
} from "@/lib/spares-statement"

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

  return [...new Set(raw.map((item) => item.trim()).filter(Boolean))]
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

  // Bulk CSV imports (ingestAlignments and friends in
  // src/actions/ingestion.ts) are admin-only, so the upload control itself
  // stays hidden from staff who'd just hit "Unauthorized" using it.
  const isAdmin = sessionClaims?.metadata?.role === "admin"

  const resolvedSearchParams = await searchParams
  const today = formatIsoDate(new Date())
  const statementEnabled = isStatementMode(
    toFilterString(resolvedSearchParams.statement)
  )
  const directorSummaryEnabled =
    !statementEnabled && isAnalyticsPeriodParam(resolvedSearchParams.period)
  const directorSummaryPeriod = parseAnalyticsPeriod(resolvedSearchParams.period)
  const directorSummaryHref = `/spares-history?period=${formatAnalyticsPeriod(directorSummaryPeriod)}`
  const statementPeriod = parseStatementPeriod(
    toFilterString(resolvedSearchParams.period)
  )
  const statementAssetType = parseStatementAssetScope(
    toFilterString(resolvedSearchParams.assetType)
  )
  const statementAssetIds = parseStatementAssetIds(
    resolvedSearchParams.fleetNo
  )
  const statementRange = statementDateRange(statementPeriod, new Date())

  const excludeFrom = toIsoDateParam(
    toFilterString(resolvedSearchParams.excludeFrom)
  )
  const excludeTo = toIsoDateParam(toFilterString(resolvedSearchParams.excludeTo))
  const hasExcludeRange = Boolean(excludeFrom && excludeTo)

  const filters: SparesHistoryFilters = statementEnabled
    ? {
        // Fetch the whole Truck / Trailer / All group. The Asset ID
        // multi-select filters that set in the statement view so operators
        // can add and remove units without another round trip.
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

  const [spares, manualEvents, statementAssets, partAliases, subEquipmentOptions, directorSummary] =
    await Promise.all([
      directorSummaryEnabled
        ? Promise.resolve([])
        : getSparesHistory(filters, {
            excludeStatementConsumables: statementEnabled,
          }),
      statementEnabled
        ? getStatementManualEvents(filters)
        : Promise.resolve([]),
      statementEnabled ? getStatementAssets() : Promise.resolve([]),
      statementEnabled ? getPartDescriptionAliases() : Promise.resolve({}),
      statementEnabled || directorSummaryEnabled
        ? Promise.resolve([] as string[])
        : getDistinctSubEquipmentValues(),
      directorSummaryEnabled
        ? getDirectorSummaryMatrix(
            directorSummaryPeriod.year,
            directorSummaryPeriod.month
          )
        : Promise.resolve(null),
    ])

  // Manual events (alignment / checks / checks pending) merge in even
  // when the asset has no physical spare rows, so those units still get
  // a statement section.
  const statementSpares = statementEnabled
    ? [...spares, ...manualEvents]
    : spares

  return (
    <main className="flex-1 bg-zinc-50 dark:bg-black">
      <section
        className={cn(
          "mx-auto flex w-full flex-col gap-6 px-6 py-16 print:max-w-none print:px-4 print:py-0 sm:px-10 lg:px-16",
          directorSummaryEnabled ? "max-w-[1600px]" : "max-w-7xl"
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
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

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin ? <AlignmentsUploadButton size="sm" /> : null}

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
                      assetType: "All",
                    })}
                  />
                }
              >
                <FileText data-icon="inline-start" />
                Generate Executive Statement
              </Button>
            )}
          </div>
        </div>

        <h1 className="text-3xl font-semibold tracking-tight text-black print:hidden sm:text-4xl dark:text-zinc-50">
          {statementEnabled
            ? "Executive Spare Statement"
            : directorSummaryEnabled
              ? "Director's Summary"
              : "Spares History"}
        </h1>

        {statementEnabled ? null : (
          <SparesHistoryTabs
            active={directorSummaryEnabled ? "director-summary" : "history"}
            directorSummaryHref={directorSummaryHref}
          />
        )}

        {statementEnabled ? (
          <SparesStatementView
            key={`${statementPeriod}-${statementAssetType}`}
            spares={statementSpares}
            period={statementPeriod}
            startDate={statementRange.startDate}
            endDate={statementRange.endDate}
            assetType={statementAssetType}
            assetIds={statementAssetIds}
            assets={statementAssets}
            aliases={partAliases}
            today={today}
          />
        ) : directorSummaryEnabled && directorSummary ? (
          <DirectorSummaryMatrix data={directorSummary} />
        ) : (
          <>
            <SparesFilterBar
              initialFilters={filters}
              subEquipmentOptions={subEquipmentOptions}
            />

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
