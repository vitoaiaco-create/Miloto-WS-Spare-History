"use client"

import { useMemo, useState } from "react"
import { useTable, type SortingState } from "@tanstack/react-table"

import {
  createMasterCostingsColumns,
  formatSpend,
  formatTotalSpend,
  masterCostingsTableFeatures,
  type MasterCostingRow,
} from "@/app/analytics/assets/table/columns"
import { MasterCostingsControls } from "@/components/master-costings-controls"
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
  masterCostingsCategoryColumns,
  type AssetComparisonFleet,
} from "@/lib/asset-comparison"

export type { MasterCostingRow }

export function MasterCostingsTable({
  assets,
  fleet,
  year,
  month,
}: {
  assets: MasterCostingRow[]
  fleet: AssetComparisonFleet
  year: number
  month?: number
}) {
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "totalUsd", desc: true },
  ])
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
        </CardContent>
      </Card>
    </div>
  )
}
