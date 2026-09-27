"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  FileSpreadsheetIcon,
  FileTextIcon,
  Loader2Icon,
  RotateCcw,
} from "lucide-react"

import {
  excludeConsumableFromStatement,
  savePartDescriptionAlias,
} from "@/actions/spares-statement"
import { AddAlignmentEventDialog } from "@/components/add-alignment-event-dialog"
import { SparesStatementTable } from "@/components/spares-table"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import {
  exportStatementExcel,
  exportStatementPdf,
  preloadStatementPdfLibs,
} from "@/lib/spares-statement-export"
import type { SparesHistoryRow } from "@/lib/spares-history"
import {
  applyStatementPreviewFilters,
  formatStatementDate,
  parseStatementAssetScope,
  statementAssetLabel,
  statementComponentLabel,
  statementComponentOptions,
  statementPeriodLabel,
  statementPeriodOptions,
  statementScopeLabel,
  sparesStatementHref,
  uniqueIdentityNos,
  type PartAliasMap,
  type StatementAssetOption,
  type StatementAssetScope,
  type StatementConsumableExclusion,
} from "@/lib/spares-statement"

export function SparesStatementView({
  spares,
  period,
  startDate,
  endDate,
  assetType,
  assetIds,
  assets,
  aliases: initialAliases,
  today,
}: {
  spares: SparesHistoryRow[]
  period: string
  startDate: string
  endDate: string
  assetType: StatementAssetScope
  assetIds: string[]
  assets: StatementAssetOption[]
  aliases: PartAliasMap
  today: string
}) {
  const router = useRouter()
  const [excludedConsumables, setExcludedConsumables] = useState<
    StatementConsumableExclusion[]
  >([])
  const [excludedAssets, setExcludedAssets] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [aliases, setAliases] = useState<PartAliasMap>(initialAliases)
  const [isExporting, setIsExporting] = useState<"pdf" | "excel" | null>(null)
  const [pdfReady, setPdfReady] = useState(false)
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(assetIds)
  const [showExcluded, setShowExcluded] = useState(true)
  const assetAnchor = useComboboxAnchor()
  const componentAnchor = useComboboxAnchor()

  const todayDate = useMemo(() => {
    const [year, month, day] = today.split("-").map(Number)
    return new Date(year, month - 1, day)
  }, [today])

  const periodOptions = useMemo(
    () => statementPeriodOptions(todayDate),
    [todayDate]
  )
  const assetsForScope = useMemo(
    () =>
      assetType === "All"
        ? assets
        : assets.filter((asset) => asset.assetType === assetType),
    [assets, assetType]
  )
  const truckAssets = useMemo(
    () => assets.filter((asset) => asset.assetType === "Truck"),
    [assets]
  )
  const trailerAssets = useMemo(
    () => assets.filter((asset) => asset.assetType === "Trailer"),
    [assets]
  )

  const componentItems = useMemo(
    () => statementComponentOptions(spares),
    [spares]
  )
  const scopedAssetIds = useMemo(
    () =>
      selectedAssetIds.filter((id) =>
        assetsForScope.some((asset) => asset.assetName === id)
      ),
    [assetsForScope, selectedAssetIds]
  )
  const assetItems = useMemo(
    () => assetsForScope.map((asset) => asset.assetName),
    [assetsForScope]
  )
  const visibleSpares = useMemo(
    () =>
      applyStatementPreviewFilters(spares, {
        assetIds: scopedAssetIds,
        categories,
        excludedAssets,
        excludedConsumables,
      }),
    [categories, excludedAssets, excludedConsumables, scopedAssetIds, spares]
  )

  const identityNos = uniqueIdentityNos(visibleSpares)
  const assetLabel = statementAssetLabel({
    assetType,
    assetIds: scopedAssetIds,
    identityNos,
  })
  const periodLabel = statementPeriodLabel(period, todayDate)
  const dateRangeLabel = `${formatStatementDate(startDate)} to ${formatStatementDate(endDate)}`
  const componentLabel = statementComponentLabel(categories)
  const sortedExcludedAssets = useMemo(
    () =>
      [...excludedAssets].sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true })
      ),
    [excludedAssets]
  )

  useEffect(() => {
    void preloadStatementPdfLibs().then(() => setPdfReady(true))
  }, [])

  function goTo(next: {
    period?: string
    assetType?: StatementAssetScope
  }) {
    const nextType = next.assetType ?? assetType
    const keepAssetIds =
      next.assetType && next.assetType !== assetType ? [] : scopedAssetIds

    router.replace(
      sparesStatementHref({
        period: next.period ?? period,
        assetType: nextType,
        assetIds: keepAssetIds,
      }),
      { scroll: false }
    )
  }

  async function removeLine(item: StatementConsumableExclusion) {
    const alreadyPending = excludedConsumables.some(
      (current) =>
        current.partNumber === item.partNumber &&
        current.materialName === item.materialName
    )

    if (!alreadyPending) {
      setExcludedConsumables((current) => [...current, item])
    }

    try {
      await excludeConsumableFromStatement(item)
      toast.add({
        title: "Excluded from future statements",
        description: `${item.materialName} will stay off the executive statement.`,
        type: "success",
      })
      router.refresh()
    } catch (error) {
      setExcludedConsumables((current) =>
        current.filter(
          (entry) =>
            entry.partNumber !== item.partNumber ||
            entry.materialName !== item.materialName
        )
      )
      toast.add({
        title: "Could not exclude consumable",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while saving the exclusion.",
        type: "error",
      })
    }
  }

  function excludeAsset(assetName: string) {
    setExcludedAssets((current) =>
      current.includes(assetName) ? current : [...current, assetName]
    )
  }

  function restoreAsset(assetName: string) {
    setExcludedAssets((current) =>
      current.filter((name) => name !== assetName)
    )
  }

  function restoreAllAssets() {
    setExcludedAssets([])
  }

  async function handleSaveAlias(sourceName: string, alias: string) {
    try {
      const result = await savePartDescriptionAlias({ sourceName, alias })
      setAliases((current) => {
        const next = { ...current }
        if (result.alias) next[result.normalizedName] = result.alias
        else delete next[result.normalizedName]
        return next
      })
    } catch (error) {
      toast.add({
        title: "Could not save alias",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while saving the part name.",
        type: "error",
      })
      throw error
    }
  }

  async function handleExport(kind: "pdf" | "excel") {
    if (visibleSpares.length === 0) return
    setIsExporting(kind)

    const meta = {
      assetType,
      assetIds: scopedAssetIds,
      assetLabel,
      periodLabel,
      dateRangeLabel,
      componentLabel,
      excludedLabel:
        sortedExcludedAssets.length > 0
          ? sortedExcludedAssets.join(", ")
          : undefined,
      aliases,
      assets,
    }

    try {
      if (kind === "pdf") {
        await exportStatementPdf(visibleSpares, meta)
      } else {
        await exportStatementExcel(visibleSpares, meta)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return

      toast.add({
        title: "Export failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while generating the file.",
        type: "error",
      })
    } finally {
      setIsExporting(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Executive statement</CardTitle>
          <CardDescription>
            Grouped by asset, then date. Removing a line permanently excludes
            that part number or material name from future statements. History
            is unchanged.
          </CardDescription>
          <CardAction>
            <AddAlignmentEventDialog
              assets={assets}
              defaultAssetName={scopedAssetIds[0] ?? ""}
              defaultDate={today}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="statement-period">Date range</Label>
              <Select
                value={period}
                onValueChange={(value) => {
                  if (!value) return
                  goTo({ period: value })
                }}
              >
                <SelectTrigger id="statement-period" className="w-full">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  {periodOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <Label>Asset group</Label>
              <Tabs
                value={assetType}
                onValueChange={(value) => {
                  goTo({ assetType: parseStatementAssetScope(value) })
                }}
              >
                <TabsList className="grid w-full grid-cols-3 lg:w-[280px]">
                  <TabsTrigger value="All">All assets</TabsTrigger>
                  <TabsTrigger value="Truck">Trucks</TabsTrigger>
                  <TabsTrigger value="Trailer">Trailers</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="statement-asset">Asset ID</Label>
              <Combobox
                multiple
                autoHighlight
                items={assetItems}
                value={scopedAssetIds}
                onValueChange={(value) =>
                  setSelectedAssetIds(Array.isArray(value) ? value : [])
                }
              >
                <ComboboxChips ref={assetAnchor} className="w-full">
                  <ComboboxValue>
                    {(selected: string[]) => {
                      const values = Array.isArray(selected) ? selected : []
                      return (
                        <>
                          {values.map((id) => (
                            <ComboboxChip key={id}>{id}</ComboboxChip>
                          ))}
                          <ComboboxChipsInput
                            id="statement-asset"
                            placeholder={
                              values.length === 0
                                ? assetType === "All"
                                  ? "All assets"
                                  : `All ${assetType.toLowerCase()}s`
                                : "Add an asset"
                            }
                          />
                        </>
                      )
                    }}
                  </ComboboxValue>
                </ComboboxChips>
                <ComboboxContent anchor={assetAnchor}>
                  <ComboboxEmpty>No asset found.</ComboboxEmpty>
                  {assetType === "All" ? (
                    <ComboboxList>
                      {truckAssets.length > 0 ? (
                        <ComboboxGroup>
                          <ComboboxLabel>Trucks</ComboboxLabel>
                          {truckAssets.map((asset) => (
                            <ComboboxItem
                              key={asset.assetName}
                              value={asset.assetName}
                            >
                              {asset.assetName}
                            </ComboboxItem>
                          ))}
                        </ComboboxGroup>
                      ) : null}
                      {trailerAssets.length > 0 ? (
                        <ComboboxGroup>
                          <ComboboxLabel>Trailers</ComboboxLabel>
                          {trailerAssets.map((asset) => (
                            <ComboboxItem
                              key={asset.assetName}
                              value={asset.assetName}
                            >
                              {asset.assetName}
                            </ComboboxItem>
                          ))}
                        </ComboboxGroup>
                      ) : null}
                    </ComboboxList>
                  ) : (
                    <ComboboxList>
                      {(item) => (
                        <ComboboxItem key={item} value={item}>
                          {item}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  )}
                </ComboboxContent>
              </Combobox>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="statement-components">Component groups</Label>
            <Combobox
              multiple
              autoHighlight
              items={componentItems}
              value={categories}
              onValueChange={(value) =>
                setCategories(Array.isArray(value) ? value : [])
              }
            >
              <ComboboxChips ref={componentAnchor} className="w-full">
                <ComboboxValue>
                  {(selected: string[]) => {
                    const values = Array.isArray(selected) ? selected : []
                    return (
                      <>
                        {values.map((category) => (
                          <ComboboxChip key={category}>{category}</ComboboxChip>
                        ))}
                        <ComboboxChipsInput
                          id="statement-components"
                          placeholder={
                            values.length === 0
                              ? "All component groups"
                              : "Add a component group"
                          }
                        />
                      </>
                    )
                  }}
                </ComboboxValue>
              </ComboboxChips>
              <ComboboxContent anchor={componentAnchor}>
                <ComboboxEmpty>No component group found.</ComboboxEmpty>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {assetLabel} · {componentLabel} · {periodLabel}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={
                  visibleSpares.length === 0 ||
                  isExporting !== null ||
                  !pdfReady
                }
                onClick={() => void handleExport("pdf")}
              >
                {isExporting === "pdf" ? (
                  <Loader2Icon data-icon="inline-start" className="animate-spin" />
                ) : (
                  <FileTextIcon data-icon="inline-start" />
                )}
                {pdfReady ? "Export to PDF" : "Preparing PDF…"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={visibleSpares.length === 0 || isExporting !== null}
                onClick={() => void handleExport("excel")}
              >
                {isExporting === "excel" ? (
                  <Loader2Icon data-icon="inline-start" className="animate-spin" />
                ) : (
                  <FileSpreadsheetIcon data-icon="inline-start" />
                )}
                Export to Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {excludedAssets.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              {excludedAssets.length} asset
              {excludedAssets.length === 1 ? "" : "s"} excluded from this
              statement.
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowExcluded((current) => !current)}
              >
                {showExcluded ? "Hide excluded" : "Show excluded"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={restoreAllAssets}
              >
                <RotateCcw data-icon="inline-start" />
                Restore all assets
              </Button>
            </div>
          </div>
          {showExcluded ? (
            <div className="flex flex-wrap gap-2">
              {sortedExcludedAssets.map((assetName) => (
                <div
                  key={assetName}
                  className="inline-flex items-center gap-1 rounded-lg border px-2 py-1"
                >
                  <span className="font-medium">{assetName}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => restoreAsset(assetName)}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl bg-white text-zinc-950 ring-1 ring-foreground/10 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="border-b px-6 py-5">
          <p className="text-xs font-semibold tracking-[0.18em] text-zinc-500 uppercase">
            Zambezi Portland Cement
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            Executive Spare Statement
          </h2>
          <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-zinc-500">Asset ID</dt>
              <dd className="font-medium">{assetLabel}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-zinc-500">Asset group</dt>
              <dd className="font-medium">{statementScopeLabel(assetType)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-zinc-500">Component groups</dt>
              <dd className="font-medium">{componentLabel}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-zinc-500">Period</dt>
              <dd className="font-medium">{periodLabel}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-zinc-500">Date range</dt>
              <dd className="font-medium">{dateRangeLabel}</dd>
            </div>
          </dl>
        </div>
        <SparesStatementTable
          spares={visibleSpares}
          assets={assets}
          aliases={aliases}
          onRemove={removeLine}
          onExcludeAsset={excludeAsset}
          onSaveAlias={handleSaveAlias}
          emptyMessage={
            excludedAssets.length > 0 ||
            excludedConsumables.length > 0 ||
            categories.length > 0 ||
            scopedAssetIds.length > 0
              ? "No spare issues match the current statement filters."
              : "No spare issues in this statement period."
          }
        />
      </div>
    </div>
  )
}
