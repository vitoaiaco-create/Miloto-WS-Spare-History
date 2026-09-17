"use client"

import type { CSSProperties } from "react"
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

export type AnalyticsCpkPoint = {
  month: string
  totalUsd: number
  cpk: number
}

const chartConfig = {
  totalUsd: {
    label: "Total spend",
    color: "var(--chart-1)",
  },
  cpk: {
    label: "Cost per km",
    color: "var(--chart-2)",
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

const cpkFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatCompactUsd(value: number) {
  return usdCompact.format(value)
}

function formatTooltipValue(dataKey: unknown, value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return "—"

  return dataKey === "cpk" ? cpkFormat.format(numeric) : usdFull.format(numeric)
}

export function AnalyticsCpkChart({ data }: { data: AnalyticsCpkPoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spend vs CPK</CardTitle>
        <CardDescription>
          Monthly workshop spend against cost per kilometre
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No monthly spend data to chart yet.
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
            <ComposedChart
              accessibilityLayer
              data={data}
              margin={{ top: 8, right: 8, left: 4 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                yAxisId="left"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width="auto"
                domain={[0, "auto"]}
                tickFormatter={(value) => formatCompactUsd(Number(value))}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width="auto"
                domain={[0, "auto"]}
                tickFormatter={(value) => cpkFormat.format(Number(value))}
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
                            {formatTooltipValue(item.dataKey, value)}
                          </span>
                        </div>
                      </>
                    )}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                yAxisId="left"
                dataKey="totalUsd"
                fill="var(--color-totalUsd)"
                radius={[4, 4, 0, 0]}
              />
              <Line
                yAxisId="right"
                dataKey="cpk"
                type="monotone"
                stroke="var(--color-cpk)"
                strokeWidth={3}
                dot={{ r: 3, strokeWidth: 2, fill: "var(--color-cpk)" }}
              />
            </ComposedChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
