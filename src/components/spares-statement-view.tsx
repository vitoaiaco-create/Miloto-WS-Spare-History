"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  FileSpreadsheetIcon,
  FileTextIcon,
  Loader2Icon,
  RotateCcw,
  Undo2,
} from "lucide-react"

import { SparesStatementTable } from "@/components/spares-table"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  formatStatementDate,
  parseStatementAssetType,
  statementAssetLabel,
  statementPeriodLabel,
  statementPeriodOptions,
  sparesStatementHref,
  uniqueIdentityNos,
  type StatementAssetOption,
  type StatementAssetType,
} from "@/lib/spares-statement"

export function SparesStatementView({
  spares,
  period,
  startDate,
  endDate,
  assetType,
  fleetNo,
  assets,
  today,
}: {
  spares: SparesHistoryRow[]
  period: string
  startDate: string
  endDate: string
  assetType: StatementAssetType
  fleetNo: string
  assets: StatementAssetOption[]
  today: string
}) {
  const router = useRouter()
  const [hiddenIds, setHiddenIds] = useState<number[]>([])
  const [isExporting, setIsExporting] = useState<"pdf" | "excel" | null>(null)
  const [pdfReady, setPdfReady] = useState(false)

  const todayDate = useMemo(() => {
    const [year, month, day] = today.split("-").map(Number)
    return new Date(year, month - 1, day)
  }, [today])

  const periodOptions = useMemo(
    () => statementPeriodOptions(todayDate),
    [todayDate]
  )
  const assetsForType = useMemo(
    () => assets.filter((asset) => asset.assetType === assetType),
    [assets, assetType]
  )

  const visibleSpares = useMemo(
    () => spares.filter((spare) => !hiddenIds.includes(spare.id)),
    [hiddenIds, spares]
  )

  const identityNos = uniqueIdentityNos(visibleSpares)
  const assetLabel = statementAssetLabel({
    assetType,
    fleetNo,
    identityNos,
  })
  const periodLabel = statementPeriodLabel(period, todayDate)
  const dateRangeLabel = `${formatStatementDate(startDate)} to ${formatStatementDate(endDate)}`

  useEffect(() => {
    void preloadStatementPdfLibs().then(() => setPdfReady(true))
  }, [])

  function goTo(next: {
    period?: string
    assetType?: StatementAssetType
    fleetNo?: string
  }) {
    const nextType = next.assetType ?? assetType
    const nextFleet =
      "fleetNo" in next
        ? (next.fleetNo ?? "")
        : next.assetType && next.assetType !== assetType
          ? ""
          : fleetNo

    router.replace(
      sparesStatementHref({
        period: next.period ?? period,
        assetType: nextType,
        fleetNo: nextFleet,
      }),
      { scroll: false }
    )
  }

  function removeLine(id: number) {
    setHiddenIds((current) => (current.includes(id) ? current : [...current, id]))
  }

  function undoLast() {
    setHiddenIds((current) => current.slice(0, -1))
  }

  function restoreAll() {
    setHiddenIds([])
  }

  async function handleExport(kind: "pdf" | "excel") {
    if (visibleSpares.length === 0) return
    setIsExporting(kind)

    const meta = {
      assetType,
      assetLabel,
      periodLabel,
      dateRangeLabel,
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
            Grouped by component for directors. Removing a line hides it from
            this view and the export only — history is unchanged.
          </CardDescription>
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
              <Label>Asset type</Label>
              <Tabs
                value={assetType}
                onValueChange={(value) => {
                  goTo({ assetType: parseStatementAssetType(value) })
                }}
              >
                <TabsList className="grid w-full grid-cols-2 lg:w-[220px]">
                  <TabsTrigger value="Truck">Truck</TabsTrigger>
                  <TabsTrigger value="Trailer">Trailer</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="statement-asset">Asset ID</Label>
              <Select
                value={fleetNo || "all"}
                onValueChange={(value) => {
                  if (!value) return
                  goTo({ fleetNo: value === "all" ? "" : value })
                }}
              >
                <SelectTrigger id="statement-asset" className="w-full">
                  <SelectValue placeholder="Select asset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All {assetType.toLowerCase()}s</SelectItem>
                  {assetsForType.map((asset) => (
                    <SelectItem key={asset.assetName} value={asset.assetName}>
                      {asset.assetName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {assetLabel} · {periodLabel}
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

      {hiddenIds.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 text-sm">
          <p>
            {hiddenIds.length} line{hiddenIds.length === 1 ? "" : "s"} hidden
            from this statement.
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={undoLast}>
              <Undo2 data-icon="inline-start" />
              Undo last
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={restoreAll}>
              <RotateCcw data-icon="inline-start" />
              Restore all
            </Button>
          </div>
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
              <dt className="text-zinc-500">Asset type</dt>
              <dd className="font-medium">{assetType}</dd>
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
          onRemove={removeLine}
          emptyMessage={
            hiddenIds.length > 0
              ? "All lines have been removed from this statement."
              : "No spare issues in this statement period."
          }
        />
      </div>
    </div>
  )
}
