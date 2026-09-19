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

const MONTH_OPTIONS = [
  { value: "ytd", label: "Full Year YTD" },
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
] as const

function assetSearchString(year: number, month?: number) {
  const params = new URLSearchParams()
  const currentYear = new Date().getFullYear()

  if (year !== currentYear) params.set("year", String(year))
  if (month !== undefined) params.set("month", String(month))

  const query = params.toString()
  return query ? `?${query}` : ""
}

export function AssetAnalyticsControls({
  assets,
  assetId,
  year,
  month,
}: {
  assets: ActiveAsset[]
  assetId: string
  year: number
  month?: number
}) {
  const router = useRouter()
  const selectedAsset = assets.find((asset) => asset.id === assetId)
  const assetNames = assets.map((asset) => asset.name)
  const monthValue = month === undefined ? "ytd" : String(month)

  function goToAsset(nextAssetId: string) {
    router.push(
      `/analytics/assets/${nextAssetId}${assetSearchString(year, month)}`
    )
  }

  function onAssetNameChange(name: string | null) {
    if (!name) return
    const asset = assets.find((item) => item.name === name)
    if (!asset || asset.id === assetId) return
    goToAsset(asset.id)
  }

  function onMonthChange(value: string | null) {
    if (!value) return

    const nextMonth =
      value === "ytd" ? undefined : Number(value)

    router.replace(
      `/analytics/assets/${assetId}${assetSearchString(year, nextMonth)}`,
      { scroll: false }
    )
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor="asset-analytics-asset">Asset</Label>
        <Combobox
          items={assetNames}
          value={selectedAsset?.name ?? null}
          onValueChange={onAssetNameChange}
        >
          <ComboboxTrigger
            render={
              <Button
                id="asset-analytics-asset"
                variant="outline"
                className="w-full justify-between font-normal"
              />
            }
          >
            <ComboboxValue placeholder="Select asset" />
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

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor="asset-analytics-month">Timeframe</Label>
        <Select value={monthValue} onValueChange={onMonthChange}>
          <SelectTrigger id="asset-analytics-month" className="w-full">
            <SelectValue placeholder="Select timeframe" />
          </SelectTrigger>
          <SelectContent>
            {MONTH_OPTIONS.map((option) => (
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
