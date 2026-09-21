"use client"

import { useMemo, useRef, useState, type CSSProperties } from "react"
import { useRouter } from "next/navigation"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Label as RechartsLabel,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import type { FleetAssetCosting } from "@/actions/analytics"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { ExportMenu } from "@/components/ui/export-menu"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { isStandardSubEquipment, STANDARD_SUB_EQUIPMENT } from "@/lib/asset-comparison"
import { normalizeSubEquipment } from "@/lib/spreadsheet"

export type AssetComparisonPoint = FleetAssetCosting & {
  href: string
}

const chartConfig = {
  totalUsd: {
    label: "Spend",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
})

const usdFull = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

function formatUsdAxis(value: number) {
  return usdCompact.format(value)
}

function formatUsdFull(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return "—"
  return usdFull.format(numeric)
}

function hrefFromBarClick(data: unknown): string | null {
  if (!data || typeof data !== "object") return null

  const payload =
    "payload" in data
      ? (data as { payload: unknown }).payload
      : data

  if (!payload || typeof payload !== "object" || !("href" in payload)) {
    return null
  }

  const href = (payload as { href: unknown }).href
  return typeof href === "string" && href.length > 0 ? href : null
}

function subEquipmentOptions(
  assets: AssetComparisonPoint[],
  averages: Record<string, number>
) {
  const extra = new Set<string>()

  for (const key of Object.keys(averages)) extra.add(key)
  for (const asset of assets) {
    for (const key of Object.keys(asset.subEquipmentSpend)) extra.add(key)
  }

  const extras = [...extra]
    .filter((key) => !isStandardSubEquipment(key))
    .sort((left, right) => left.localeCompare(right))

  return [...STANDARD_SUB_EQUIPMENT, ...extras]
}

function SpendBarChart({
  data,
  average,
  averageLabel,
  emptyMessage,
}: {
  data: Array<{ assetId: string; totalUsd: number; href: string }>
  average: number
  averageLabel: string
  emptyMessage: string
}) {
  const router = useRouter()

  function onBarClick(data: unknown) {
    const href = hrefFromBarClick(data)
    if (href) router.push(href)
  }

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-[360px] w-full min-w-[640px]"
      >
        <BarChart
          accessibilityLayer
          data={data}
          margin={{ top: 18, right: 16, left: 4, bottom: 8 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="assetId"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval={0}
            angle={-40}
            textAnchor="end"
            height={72}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width="auto"
            domain={[0, "auto"]}
            tickFormatter={(value) => formatUsdAxis(Number(value))}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name, item) => (
                  <>
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)"
                      style={
                        {
                          "--color-bg": item.color,
                          "--color-border": item.color,
                        } as CSSProperties
                      }
                    />
                    <div className="flex flex-1 items-center justify-between leading-none">
                      <span className="text-muted-foreground">
                        {chartConfig[name as keyof typeof chartConfig]
                          ?.label ?? name}
                      </span>
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {formatUsdFull(value)}
                      </span>
                    </div>
                  </>
                )}
              />
            }
          />
          <ReferenceLine
            y={average}
            stroke="var(--color-totalUsd)"
            strokeDasharray="6 4"
            ifOverflow="extendDomain"
          >
            <RechartsLabel
              value={averageLabel}
              position="insideTopRight"
              fill="var(--muted-foreground)"
              fontSize={12}
            />
          </ReferenceLine>
          <Bar
            dataKey="totalUsd"
            fill="var(--color-totalUsd)"
            radius={4}
            maxBarSize={48}
            cursor="pointer"
            onClick={onBarClick}
          />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

export function AssetComparisonCharts({
  assets,
  fleetOverallAverage,
  subEquipmentAverages,
}: {
  assets: AssetComparisonPoint[]
  fleetOverallAverage: number
  subEquipmentAverages: Record<string, number>
}) {
  const categories = useMemo(
    () => subEquipmentOptions(assets, subEquipmentAverages),
    [assets, subEquipmentAverages]
  )
  const overallChartRef = useRef<HTMLDivElement>(null)
  const subEqChartRef = useRef<HTMLDivElement>(null)
  const [selectedCategory, setSelectedCategory] = useState(
    categories.includes("ENGINE") ? "ENGINE" : (categories[0] ?? "ENGINE")
  )
  const categoryAverage = subEquipmentAverages[selectedCategory] ?? 0
  const subEquipmentData = assets.map((asset) => ({
    assetId: asset.assetId,
    href: asset.href,
    totalUsd: asset.subEquipmentSpend[selectedCategory] ?? 0,
  }))

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Overall Asset Spend</CardTitle>
          <CardDescription>
            Total workshop spend per asset versus the fleet-wide average. Click
            a bar to open that asset&apos;s deep-dive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative border rounded-md p-4 bg-background">
            <ExportMenu
              className="absolute top-2 right-2 z-10"
              targetRef={overallChartRef}
              filename="overall-spend-cohort"
            />
            <div ref={overallChartRef} className="bg-background pt-2">
              <SpendBarChart
                data={assets}
                average={fleetOverallAverage}
                averageLabel={`Fleet avg ${formatUsdAxis(fleetOverallAverage)}`}
                emptyMessage="No asset spend to chart for this view."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sub-Equipment Spend Comparison</CardTitle>
          <CardDescription>
            Spend on the selected sub-equipment versus that category&apos;s
            fleet-wide average. Click a bar to open that asset&apos;s
            deep-dive.
          </CardDescription>
          <CardAction>
            <div className="flex min-w-[12rem] flex-col gap-1.5">
              <Label htmlFor="asset-comparison-sub-equipment">
                Sub Equipment
              </Label>
              <Select
                value={selectedCategory}
                onValueChange={(value) => {
                  if (value) setSelectedCategory(value)
                }}
              >
                <SelectTrigger
                  id="asset-comparison-sub-equipment"
                  className="w-full"
                >
                  <SelectValue placeholder="Select sub equipment" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {normalizeSubEquipment(category)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="relative border rounded-md p-4 bg-background">
            <ExportMenu
              className="absolute top-2 right-2 z-10"
              targetRef={subEqChartRef}
              filename="sub-equipment-spend-cohort"
            />
            <div ref={subEqChartRef} className="bg-background pt-2">
              <SpendBarChart
                data={subEquipmentData}
                average={categoryAverage}
                averageLabel={`${normalizeSubEquipment(selectedCategory)} avg ${formatUsdAxis(categoryAverage)}`}
                emptyMessage="No sub-equipment spend to chart for this view."
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
