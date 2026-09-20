"use client"

import { useRouter } from "next/navigation"

import { Input } from "@/components/ui/input"
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
  type AssetComparisonFleet,
} from "@/lib/asset-comparison"

export function MasterCostingsControls({
  fleet,
  year,
  month,
  query,
  onQueryChange,
}: {
  fleet: AssetComparisonFleet
  year: number
  month?: number
  query: string
  onQueryChange: (value: string) => void
}) {
  const router = useRouter()
  const monthValue = month === undefined ? "ytd" : String(month)

  function goTo(next: {
    fleet?: AssetComparisonFleet
    month?: number | undefined
  }) {
    router.replace(
      `/analytics/assets/table${assetComparisonSearchString({
        fleet: next.fleet ?? fleet,
        year,
        month: "month" in next ? next.month : month,
      })}`,
      { scroll: false }
    )
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
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
        <Label htmlFor="master-costings-month">Timeframe</Label>
        <Select
          value={monthValue}
          onValueChange={(value) => {
            if (!value) return
            goTo({
              month: value === "ytd" ? undefined : Number(value),
            })
          }}
        >
          <SelectTrigger id="master-costings-month" className="w-full">
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

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor="master-costings-search">Asset Search</Label>
        <Input
          id="master-costings-search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter by Miloto No..."
        />
      </div>
    </div>
  )
}
