"use client"

import { useId, useRef, useState, type CSSProperties } from "react"
import {
  CartesianGrid,
  Label as RechartsLabel,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

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
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export type AnalyticsCpkPoint = {
  month: string
  totalUsd: number
  cpk: number
}

type ChartMetric = "totalUsd" | "cpk"

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

function formatAxisValue(metric: ChartMetric, value: number) {
  return metric === "cpk" ? cpkFormat.format(value) : usdCompact.format(value)
}

function formatTooltipValue(metric: ChartMetric, value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric)) return "—"

  return metric === "cpk" ? cpkFormat.format(numeric) : usdFull.format(numeric)
}

export function AnalyticsCpkChart({
  data,
  avgTotalUsd,
  avgCpk,
}: {
  data: AnalyticsCpkPoint[]
  avgTotalUsd: number | null
  avgCpk: number | null
}) {
  const switchId = useId()
  const chartRef = useRef<HTMLDivElement>(null)
  const [metric, setMetric] = useState<ChartMetric>("totalUsd")
  const isCpk = metric === "cpk"
  const average = isCpk ? avgCpk : avgTotalUsd

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isCpk ? "Cost per km" : "Monthly spend"}</CardTitle>
        <CardDescription>
          {isCpk
            ? "Month-on-month workshop cost per kilometre"
            : "Month-on-month workshop spend in USD"}
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-2">
            <Label
              className={cn(
                "cursor-pointer",
                isCpk && "text-muted-foreground"
              )}
              onClick={() => setMetric("totalUsd")}
            >
              USD spend
            </Label>
            <Switch
              id={switchId}
              checked={isCpk}
              onCheckedChange={(checked) =>
                setMetric(checked ? "cpk" : "totalUsd")
              }
            />
            <Label htmlFor={switchId} className="sr-only">
              Show cost per km instead of USD spend
            </Label>
            <Label
              className={cn(
                "cursor-pointer",
                !isCpk && "text-muted-foreground"
              )}
              onClick={() => setMetric("cpk")}
            >
              CPK
            </Label>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="relative mt-4 rounded-md border bg-background p-4 pt-8">
          <ExportMenu
            targetRef={chartRef}
            filename={isCpk ? "financials-cpk-chart" : "financials-monthly-spend"}
            className="absolute top-2 right-2 z-40"
          />
          <div ref={chartRef} className="bg-background">
            {data.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No monthly spend data to chart yet.
              </p>
            ) : (
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-[280px] w-full"
              >
                <LineChart
                  accessibilityLayer
                  data={data}
                  margin={{ top: 18, right: 12, left: 4 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    width="auto"
                    domain={[0, "auto"]}
                    tickFormatter={(value) =>
                      formatAxisValue(metric, Number(value))
                    }
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
                                {formatTooltipValue(metric, value)}
                              </span>
                            </div>
                          </>
                        )}
                      />
                    }
                  />
                  {average != null ? (
                    <ReferenceLine
                      y={average}
                      stroke={`var(--color-${metric})`}
                      strokeDasharray="3 3"
                    >
                      <RechartsLabel
                        value={`Avg ${formatAxisValue(metric, average)}`}
                        position="insideTopRight"
                        fill="var(--muted-foreground)"
                        fontSize={12}
                      />
                    </ReferenceLine>
                  ) : null}
                  <Line
                    key={metric}
                    dataKey={metric}
                    type="monotone"
                    stroke={`var(--color-${metric})`}
                    strokeWidth={2.5}
                    dot={{
                      r: 3,
                      strokeWidth: 2,
                      fill: `var(--color-${metric})`,
                    }}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
