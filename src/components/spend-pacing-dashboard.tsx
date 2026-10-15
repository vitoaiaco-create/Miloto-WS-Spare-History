"use client"

import { useEffect, useId, useRef, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Label as RechartsLabel,
  Line,
  LineChart,
  ReferenceDot,
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
import { Slider } from "@/components/ui/slider"
import { analyticsPeriodLabel, type AnalyticsPeriod } from "@/lib/analytics-period"

function buildChartConfig(periodLabel: string) {
  return {
    actual: {
      label: periodLabel,
      color: "var(--chart-1)",
    },
    target: {
      label: "YTD average",
      color: "var(--chart-2)",
    },
  } satisfies ChartConfig
}

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

function formatDailyDate(period: AnalyticsPeriod, day: number) {
  return new Date(period.year, period.month - 1, day).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric" }
  )
}

export function SpendPacingDashboard({
  dailyPacing,
  weeklyPacing,
  historicalDailyAvg,
  historicalWeeklyAvg,
  period,
}: SpendPacing & { period: AnalyticsPeriod }) {
  const fillId = `spend-pacing-actual-${useId().replace(/:/g, "")}`
  const dailyChartRef = useRef<HTMLDivElement>(null)
  const weeklyChartRef = useRef<HTMLDivElement>(null)
  const periodLabel = analyticsPeriodLabel(period)
  const chartConfig = buildChartConfig(periodLabel)
  const [activeIndex, setActiveIndex] = useState<number | null>(
    dailyPacing.length > 0 ? dailyPacing.length - 1 : null
  )
  const activeData =
    activeIndex !== null ? (dailyPacing[activeIndex] ?? null) : null

  useEffect(() => {
    setActiveIndex(dailyPacing.length > 0 ? dailyPacing.length - 1 : null)
  }, [dailyPacing.length, period.year, period.month])

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Daily spend pacing</CardTitle>
          <CardDescription>
            {periodLabel}&apos;s daily spend versus the year-to-date daily
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
                <>
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-lg font-bold tracking-tight">
                      Date:{" "}
                      <span className="tabular-nums">
                        {activeData
                          ? formatDailyDate(period, activeData.day)
                          : "—"}
                      </span>
                    </p>
                    <p className="text-lg font-bold tabular-nums">
                      Spend:{" "}
                      {activeData ? usdFull.format(activeData.actual) : "—"}
                    </p>
                  </div>
                  <ChartContainer
                    config={chartConfig}
                    className="aspect-auto h-[280px] w-full [&_.recharts-tooltip-wrapper]:hidden sm:[&_.recharts-tooltip-wrapper]:block"
                  >
                    <AreaChart
                      accessibilityLayer
                      data={dailyPacing}
                      margin={{ top: 18, right: 12, left: 4 }}
                      onMouseMove={(event) => {
                        const index = event.activeTooltipIndex
                        if (index === undefined) return
                        const next =
                          typeof index === "number" ? index : Number(index)
                        if (Number.isInteger(next)) {
                          setActiveIndex(next)
                        }
                      }}
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
                    {activeIndex !== null && dailyPacing[activeIndex] && (
                      <>
                        <ReferenceLine
                          className="sm:hidden"
                          stroke="var(--color-actual)"
                          strokeDasharray="4 4"
                          x={dailyPacing[activeIndex].day}
                        />
                        <ReferenceDot
                          className="sm:hidden pointer-events-none"
                          fill="var(--color-actual)"
                          r={5}
                          stroke="var(--background)"
                          strokeWidth={2}
                          x={dailyPacing[activeIndex].day}
                          y={dailyPacing[activeIndex].actual}
                        />
                      </>
                    )}
                    <ChartTooltip
                      wrapperClassName="hidden sm:block"
                      content={
                        <ChartTooltipContent
                          className="hidden sm:block"
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
                </>
              )}
            </div>
            {dailyPacing.length > 1 ? (
              <div className="mt-4 block sm:hidden">
                <Slider
                  min={0}
                  max={dailyPacing.length - 1}
                  step={1}
                  value={[activeIndex ?? 0]}
                  aria-label="Scrub daily spend"
                  onValueChange={(vals) => {
                    const next = Array.isArray(vals) ? vals[0] : vals
                    setActiveIndex(next)
                  }}
                />
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly spend pacing</CardTitle>
          <CardDescription>
            {periodLabel}&apos;s weekly spend versus the year-to-date weekly
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
