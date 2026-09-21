"use client"

import { useId, useRef } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Label as RechartsLabel,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import type { SpendPacing } from "@/actions/analytics"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ExportMenu } from "@/components/ui/export-menu"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

const chartConfig = {
  actual: {
    label: "This month",
    color: "var(--chart-1)",
  },
  target: {
    label: "YTD average",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
})

function formatUsdAxis(value: number) {
  return usdCompact.format(value)
}

export function SpendPacingDashboard({
  dailyPacing,
  weeklyPacing,
  historicalDailyAvg,
  historicalWeeklyAvg,
}: SpendPacing) {
  const fillId = `spend-pacing-actual-${useId().replace(/:/g, "")}`
  const dailyChartRef = useRef<HTMLDivElement>(null)
  const weeklyChartRef = useRef<HTMLDivElement>(null)

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Daily spend pacing</CardTitle>
          <CardDescription>
            This month&apos;s daily spend versus the year-to-date daily
            average
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mt-4 rounded-md border bg-background p-4 pt-8">
            <ExportMenu
              targetRef={dailyChartRef}
              filename="financials-daily-pacing"
              className="absolute top-2 right-2 z-40"
            />
            <div ref={dailyChartRef} className="bg-background">
              {dailyPacing.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No daily spend data to chart yet.
                </p>
              ) : (
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto h-[280px] w-full"
                >
                  <AreaChart
                    accessibilityLayer
                    data={dailyPacing}
                    margin={{ top: 18, right: 12, left: 4 }}
                  >
                    <defs>
                      <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="5%"
                          stopColor="var(--color-actual)"
                          stopOpacity={0.45}
                        />
                        <stop
                          offset="95%"
                          stopColor="var(--color-actual)"
                          stopOpacity={0.05}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="day"
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
                      tickFormatter={(value) => formatUsdAxis(Number(value))}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(_value, payload) => {
                            const day = payload?.[0]?.payload?.day
                            return day != null ? `Day ${day}` : "Day"
                          }}
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <ReferenceLine
                      y={historicalDailyAvg}
                      stroke="var(--color-target)"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      ifOverflow="extendDomain"
                    >
                      <RechartsLabel
                        value={`YTD avg ${formatUsdAxis(historicalDailyAvg)}`}
                        position="insideTopRight"
                        fill="var(--color-target)"
                        fontSize={12}
                        fontWeight={600}
                      />
                    </ReferenceLine>
                    <Area
                      dataKey="actual"
                      type="monotone"
                      fill={`url(#${fillId})`}
                      stroke="var(--color-actual)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly spend pacing</CardTitle>
          <CardDescription>
            This month&apos;s weekly spend versus the year-to-date weekly
            average
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mt-4 rounded-md border bg-background p-4 pt-8">
            <ExportMenu
              targetRef={weeklyChartRef}
              filename="financials-weekly-pacing"
              className="absolute top-2 right-2 z-40"
            />
            <div ref={weeklyChartRef} className="bg-background">
              {weeklyPacing.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No weekly spend data to chart yet.
                </p>
              ) : (
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto h-[280px] w-full"
                >
                  <LineChart
                    accessibilityLayer
                    data={weeklyPacing}
                    margin={{ top: 18, right: 12, left: 4 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="week"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value) => `Week ${value}`}
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
                          labelFormatter={(_value, payload) => {
                            const week = payload?.[0]?.payload?.week
                            return week != null ? `Week ${week}` : "Week"
                          }}
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <ReferenceLine
                      y={historicalWeeklyAvg}
                      stroke="var(--color-target)"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      ifOverflow="extendDomain"
                    >
                      <RechartsLabel
                        value={`YTD avg ${formatUsdAxis(historicalWeeklyAvg)}`}
                        position="insideTopRight"
                        fill="var(--color-target)"
                        fontSize={12}
                        fontWeight={600}
                      />
                    </ReferenceLine>
                    <Line
                      dataKey="actual"
                      type="monotone"
                      stroke="var(--color-actual)"
                      strokeWidth={2.5}
                      dot={{
                        r: 3,
                        strokeWidth: 2,
                        fill: "var(--color-actual)",
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
    </div>
  )
}
