"use client"

import { useMemo, useRef, useState } from "react"
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { ArrowUpDown } from "lucide-react"
import Link from "next/link"

import type {
  FleetAssetCosting,
  FleetAssetCostings,
} from "@/actions/analytics"
import { MasterCostingsControls } from "@/components/master-costings-controls"
import { Button } from "@/components/ui/button"
import { ExportMenu } from "@/components/ui/export-menu"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  assetDetailSearchString,
  masterCostingsCategoryColumns,
  type AssetComparisonFleet,
} from "@/lib/asset-comparison"
import { sparesHistoryHref } from "@/lib/spares-history-href"
import { normalizeSubEquipment } from "@/lib/spreadsheet"

const masterCostingsTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic },
  columnMeta: {} as {
    headerClassName?: string
    cellClassName?: string
    footerClassName?: string
  },
})

type MasterCostingsTableFeatures = typeof masterCostingsTableFeatures

export type MasterCostingRow = FleetAssetCosting & {
  href: string
}

export type ClientTableData = FleetAssetCostings | FleetAssetCosting[]

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatSpend(value: number) {
  if (!Number.isFinite(value) || value === 0) return "—"
  return usdFormat.format(value)
}

function formatTotalSpend(value: number) {
  return usdFormat.format(value)
}

const columnHelper = createColumnHelper<
  MasterCostingsTableFeatures,
  MasterCostingRow
>()

const stickyAssetHeaderClassName =
  "sticky top-0 left-0 z-30 min-w-[7rem] bg-card border-r shadow-[2px_2px_5px_-2px_rgba(0,0,0,0.1)]"
const stickyNumericHeaderClassName =
  "sticky top-0 z-20 min-w-[8.5rem] bg-card text-right shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]"
const stickyCategoryHeaderClassName =
  "sticky top-0 z-20 min-w-[7.5rem] bg-card text-right shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]"

function createMasterCostingsColumns(
  categories: string[]
): ColumnDef<MasterCostingsTableFeatures, MasterCostingRow>[] {
  return [
    columnHelper.accessor("assetId", {
      header: "Asset ID",
      enableSorting: false,
      cell: ({ row }) => (
        <Link
          href={row.original.href}
          className="underline-offset-4 hover:underline"
        >
          {row.original.assetId}
        </Link>
      ),
      meta: {
        headerClassName: stickyAssetHeaderClassName,
        cellClassName:
          "sticky left-0 z-10 bg-card font-medium border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]",
        footerClassName: "sticky left-0 z-10 bg-muted font-semibold border-r",
      },
    }),
    columnHelper.accessor("totalUsd", {
      sortFn: "basic",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Total Spend (USD) <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ getValue }) => formatSpend(getValue()),
      meta: {
        headerClassName: stickyNumericHeaderClassName,
        cellClassName: "text-right font-mono tabular-nums",
        footerClassName:
          "text-right font-mono text-sm font-semibold tabular-nums",
      },
    }),
    ...categories.map((category) =>
      columnHelper.accessor((row) => row.subEquipmentSpend[category] ?? 0, {
        id: category,
        sortFn: "basic",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
            >
              {normalizeSubEquipment(category)}{" "}
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        },
        cell: ({ getValue, row }) => {
          const formatted = formatSpend(getValue())
          if (formatted === "—") return formatted

          return (
            <Link
              href={sparesHistoryHref({
                fleetNo: row.original.assetId,
                subEquipment: normalizeSubEquipment(category),
              })}
              className="hover:underline text-blue-600 dark:text-blue-400 font-medium cursor-pointer"
            >
              {formatted}
            </Link>
          )
        },
        meta: {
          headerClassName: stickyCategoryHeaderClassName,
          cellClassName: "text-right font-mono tabular-nums",
          footerClassName:
            "text-right font-mono text-sm font-semibold tabular-nums",
        },
      })
    ),
  ] as ColumnDef<MasterCostingsTableFeatures, MasterCostingRow>[]
}

function toCostingAssets(
  data: ClientTableData | undefined
): FleetAssetCosting[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  return data.assets ?? []
}

export function ClientTable({
  data,
  fleet,
  year,
  month,
}: {
  data: ClientTableData
  fleet: AssetComparisonFleet
  year: number
  month?: number
}) {
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "totalUsd", desc: true },
  ])
  const assets = useMemo(
    () =>
      [...toCostingAssets(data)]
        .sort(
          (left, right) =>
            right.totalUsd - left.totalUsd ||
            left.assetId.localeCompare(right.assetId)
        )
        .map((asset) => ({
          ...asset,
          href: `/analytics/assets/${encodeURIComponent(asset.assetId)}${assetDetailSearchString(
            year,
            month
          )}`,
        })),
    [data, month, year]
  )
  const categories = useMemo(
    () => masterCostingsCategoryColumns(assets),
    [assets]
  )
  const columns = useMemo(
    () => createMasterCostingsColumns(categories),
    [categories]
  )
  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return assets
    return assets.filter((asset) =>
      asset.assetId.toLowerCase().includes(needle)
    )
  }, [assets, query])
  const totals = useMemo(() => {
    const categoryTotals: Record<string, number> = {}
    let totalUsd = 0

    for (const asset of filteredAssets) {
      totalUsd += asset.totalUsd
      for (const category of categories) {
        categoryTotals[category] =
          (categoryTotals[category] ?? 0) +
          (asset.subEquipmentSpend[category] ?? 0)
      }
    }

    return { totalUsd, categoryTotals }
  }, [categories, filteredAssets])
  const table = useTable({
    features: masterCostingsTableFeatures,
    data: filteredAssets,
    columns,
    getRowId: (row) => row.assetId,
    onSortingChange: setSorting,
    state: {
      sorting,
    },
  })
  const rows = table.getRowModel().rows
  const columnCount = table.getAllLeafColumns().length
  const hasQuery = query.trim().length > 0
  const tableRef = useRef<HTMLDivElement>(null)
  const csvData = useMemo(
    () =>
      filteredAssets.map((asset) => {
        const row: Record<string, unknown> = {
          assetId: asset.assetId,
          totalUsd: asset.totalUsd,
        }
        for (const category of categories) {
          row[category] = asset.subEquipmentSpend[category] ?? 0
        }
        return row
      }),
    [categories, filteredAssets]
  )

  return (
    <div className="flex flex-col gap-6">
      <MasterCostingsControls
        fleet={fleet}
        year={year}
        month={month}
        query={query}
        onQueryChange={setQuery}
      />

      <Card>
        <CardHeader>
          <CardTitle>Master Costings Table</CardTitle>
          <CardDescription>
            Fleet maintenance spend by asset and sub-equipment for the selected
            timeframe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div ref={tableRef} className="relative">
            <ExportMenu
              className="absolute top-2 right-2 z-40"
              targetRef={tableRef}
              tableData={csvData}
              filename="master-costings"
            />
            <Table containerClassName="relative w-full overflow-auto max-h-[70vh]">
              <TableHeader className="sticky top-0 z-20 bg-card shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className={header.column.columnDef.meta?.headerClassName}
                      >
                        {header.isPlaceholder ? null : (
                          <table.FlexRender header={header} />
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columnCount}
                      className="text-muted-foreground"
                    >
                      {hasQuery
                        ? "No assets match that Miloto No."
                        : "No maintenance costings recorded for this period"}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getAllCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cell.column.columnDef.meta?.cellClassName}
                        >
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
              {rows.length > 0 ? (
                <TableFooter>
                  <TableRow className="bg-muted hover:bg-muted">
                    {table.getAllLeafColumns().map((column) => (
                      <TableCell
                        key={column.id}
                        className={column.columnDef.meta?.footerClassName}
                      >
                        {column.id === "assetId"
                          ? "Total"
                          : column.id === "totalUsd"
                            ? formatTotalSpend(totals.totalUsd)
                            : formatSpend(totals.categoryTotals[column.id] ?? 0)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
