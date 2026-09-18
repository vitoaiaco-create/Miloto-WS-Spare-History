"use client"

import { useId } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"

import type { DailyPacingPoint, WeeklyPacingPoint } from "@/actions/analytics"
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

const chartConfig = {
  actual: {
    label: "This month",
    color: "var(--chart-1)",
  },
  target: {
    label: "Historical average",
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
}: {
  dailyPacing: DailyPacingPoint[]
  weeklyPacing: WeeklyPacingPoint[]
}) {
  const fillId = `spend-pacing-actual-${useId().replace(/:/g, "")}`

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Daily spend pacing</CardTitle>
          <CardDescription>
            This month versus the historical average for each day of the
            month
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                margin={{ top: 8, right: 8, left: 4 }}
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
                <Area
                  dataKey="actual"
                  type="monotone"
                  fill={`url(#${fillId})`}
                  stroke="var(--color-actual)"
                  strokeWidth={2}
                />
                <Area
                  dataKey="target"
                  type="monotone"
                  fill="none"
                  stroke="var(--color-target)"
                  strokeWidth={2}
                  strokeDasharray="3 3"
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly spend pacing</CardTitle>
          <CardDescription>
            This month versus the historical average for each week of the
            month
          </CardDescription>
        </CardHeader>
        <CardContent>
          {weeklyPacing.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No weekly spend data to chart yet.
            </p>
          ) : (
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-[280px] w-full"
            >
              <BarChart
                accessibilityLayer
                data={weeklyPacing}
                margin={{ top: 8, right: 8, left: 4 }}
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
                <Bar
                  dataKey="actual"
                  fill="var(--color-actual)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="target"
                  fill="var(--color-target)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
