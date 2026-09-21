"use client"

import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  type ColumnDef,
} from "@tanstack/react-table"
import { ArrowUpDown } from "lucide-react"
import Link from "next/link"

import type { FleetAssetCosting } from "@/actions/analytics"
import { Button } from "@/components/ui/button"
import { sparesHistoryHref } from "@/lib/spares-history"
import { normalizeSubEquipment } from "@/lib/spreadsheet"

export const masterCostingsTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic },
  columnMeta: {} as {
    headerClassName?: string
    cellClassName?: string
    footerClassName?: string
  },
})

export type MasterCostingsTableFeatures = typeof masterCostingsTableFeatures

export type MasterCostingRow = FleetAssetCosting & {
  href: string
}

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatSpend(value: number) {
  if (!Number.isFinite(value) || value === 0) return "—"
  return usdFormat.format(value)
}

export function formatTotalSpend(value: number) {
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

export function createMasterCostingsColumns(
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
              {normalizeSubEquipment(category)} <ArrowUpDown className="ml-2 h-4 w-4" />
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
