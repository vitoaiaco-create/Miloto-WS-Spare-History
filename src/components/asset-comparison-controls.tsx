"use client"

import { useRouter } from "next/navigation"

import type { ActiveAsset } from "@/actions/analytics"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
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
import {
  ASSET_COMPARISON_MONTH_OPTIONS,
  assetComparisonSearchString,
  assetDetailSearchString,
  cohortOptions,
  parseAssetComparisonView,
  type AssetComparisonFleet,
  type AssetComparisonView,
} from "@/lib/asset-comparison"

export function AssetComparisonControls({
  assets,
  fleet,
  view,
  year,
  month,
}: {
  assets: ActiveAsset[]
  fleet: AssetComparisonFleet
  view: AssetComparisonView
  year: number
  month?: number
}) {
  const router = useRouter()
  const monthValue = month === undefined ? "ytd" : String(month)
  const views = cohortOptions(fleet)
  const assetNames = assets.map((asset) => asset.name)

  function goTo(next: {
    fleet?: AssetComparisonFleet
    view?: AssetComparisonView
    month?: number | undefined
  }) {
    router.replace(
      `/analytics/assets${assetComparisonSearchString({
        fleet: next.fleet ?? fleet,
        view: next.view ?? view,
        year,
        month: "month" in next ? next.month : month,
      })}`,
      { scroll: false }
    )
  }

  function onJumpToAsset(name: string | null) {
    if (!name) return
    const asset = assets.find((item) => item.name === name)
    if (!asset) return
    router.push(
      `/analytics/assets/${encodeURIComponent(asset.name)}${assetDetailSearchString(
        year,
        month
      )}`
    )
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor="asset-comparison-jump">Jump to Asset...</Label>
        <Combobox items={assetNames} value={null} onValueChange={onJumpToAsset}>
          <ComboboxTrigger
            render={
              <Button
                id="asset-comparison-jump"
                variant="outline"
                className="w-full justify-between font-normal"
              />
            }
          >
            <ComboboxValue placeholder="Jump to Asset..." />
          </ComboboxTrigger>
          <ComboboxContent>
            <ComboboxInput
              showTrigger={false}
              placeholder="Search assets..."
            />
            <ComboboxEmpty>No assets found.</ComboboxEmpty>
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

      <div className="flex min-w-0 flex-col gap-1.5">
        <Label>Fleet Type</Label>
        <Tabs
          value={fleet}
          onValueChange={(value) => {
            if (value === "trucks" || value === "trailers") {
              goTo({ fleet: value })
            }
          }}
        >
          <TabsList className="grid w-full grid-cols-2 lg:w-[220px]">
            <TabsTrigger value="trucks">Trucks</TabsTrigger>
            <TabsTrigger value="trailers">Trailers</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor="asset-comparison-view">View</Label>
        <Select
          value={view}
          onValueChange={(value) => {
            if (!value) return
            goTo({ view: parseAssetComparisonView(value) })
          }}
        >
          <SelectTrigger id="asset-comparison-view" className="w-full">
            <SelectValue placeholder="Select view" />
          </SelectTrigger>
          <SelectContent>
            {views.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor="asset-comparison-month">Timeframe</Label>
        <Select
          value={monthValue}
          onValueChange={(value) => {
            if (!value) return
            goTo({
              month: value === "ytd" ? undefined : Number(value),
            })
          }}
        >
          <SelectTrigger id="asset-comparison-month" className="w-full">
            <SelectValue placeholder="Select timeframe" />
          </SelectTrigger>
          <SelectContent>
            {ASSET_COMPARISON_MONTH_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
