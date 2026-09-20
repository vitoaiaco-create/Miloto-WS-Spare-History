"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

import type { FleetAssetCosting } from "@/actions/analytics"
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
import { normalizeSubEquipment } from "@/lib/spreadsheet"

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export type MasterCostingRow = FleetAssetCosting & {
  href: string
}

function formatSpend(value: number) {
  if (!Number.isFinite(value) || value === 0) return "—"
  return usdFormat.format(value)
}

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
  const categories = useMemo(
    () => masterCostingsCategoryColumns(assets),
    [assets]
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
  const columnCount = categories.length + 2
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
              <TableRow>
                <TableHead className="sticky top-0 left-0 z-30 min-w-[7rem] bg-card border-r shadow-[2px_2px_5px_-2px_rgba(0,0,0,0.1)]">
                  Asset ID
                </TableHead>
                <TableHead className="sticky top-0 z-20 min-w-[8.5rem] bg-card text-right shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]">
                  Total Spend (USD)
                </TableHead>
                {categories.map((category) => (
                  <TableHead
                    key={category}
                    className="sticky top-0 z-20 min-w-[7.5rem] bg-card text-right shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]"
                  >
                    {normalizeSubEquipment(category)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAssets.length === 0 ? (
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
                filteredAssets.map((asset) => (
                  <TableRow key={asset.assetId}>
                    <TableCell className="sticky left-0 z-10 bg-card font-medium border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                      <Link
                        href={asset.href}
                        className="underline-offset-4 hover:underline"
                      >
                        {asset.assetId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatSpend(asset.totalUsd)}
                    </TableCell>
                    {categories.map((category) => (
                      <TableCell
                        key={category}
                        className="text-right font-mono tabular-nums"
                      >
                        {formatSpend(asset.subEquipmentSpend[category] ?? 0)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
            {filteredAssets.length > 0 ? (
              <TableFooter>
                <TableRow className="bg-muted hover:bg-muted">
                  <TableCell className="sticky left-0 z-10 bg-muted font-semibold border-r">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                    {usdFormat.format(totals.totalUsd)}
                  </TableCell>
                  {categories.map((category) => (
                    <TableCell
                      key={category}
                      className="text-right font-mono text-sm font-semibold tabular-nums"
                    >
                      {formatSpend(totals.categoryTotals[category] ?? 0)}
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
