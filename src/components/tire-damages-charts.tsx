"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Label as RechartsLabel,
  XAxis,
  YAxis,
} from "recharts"

import type { TireDamageAssetCount } from "@/actions/logistics"
import {
  Card,
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

const chartConfig = {
  damageCount: {
    label: "Incident Count",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

function TireDamageBarChart({
  data,
  emptyMessage,
}: {
  data: TireDamageAssetCount[]
  emptyMessage: string
}) {
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
          margin={{ top: 18, right: 16, left: 12, bottom: 8 }}
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
            width={56}
            allowDecimals={false}
            domain={[0, "auto"]}
          >
            <RechartsLabel
              value="Incident Count"
              angle={-90}
              position="insideLeft"
              offset={-4}
              style={{
                fill: "var(--muted-foreground)",
                fontSize: 12,
                textAnchor: "middle",
              }}
            />
          </YAxis>
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) => (
                  <div className="flex flex-1 items-center justify-between leading-none">
                    <span className="text-muted-foreground">
                      {chartConfig[name as keyof typeof chartConfig]?.label ??
                        name}
                    </span>
                    <span className="font-mono font-medium text-foreground tabular-nums">
                      {value}
                    </span>
                  </div>
                )}
              />
            }
          />
          <Bar
            dataKey="damageCount"
            fill="var(--color-damageCount)"
            radius={4}
            maxBarSize={48}
          />
        </BarChart>
      </ChartContainer>
    </div>
  )
}

// Two Tyre Damages bar charts for the Logistics Analytics dashboard — one
// for Motive Units (Trucks), one for Towed Units (Trailers). Both are fed
// by `getTireDamagesByAsset` (src/actions/analytics.ts), which already
// restricts each dataset to assets with 2+ operational tyre damages for
// the given year and excludes Cranes from the Motive Units dataset.
export function TireDamagesCharts({
  trucks,
  trailers,
  year,
}: {
  trucks: TireDamageAssetCount[]
  trailers: TireDamageAssetCount[]
  year: number
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Motive Units — Tyre Damages ({year})</CardTitle>
          <CardDescription>
            Trucks with 2 or more operational tyre damages in {year}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TireDamageBarChart
            data={trucks}
            emptyMessage={`No trucks had 2 or more operational tyre damages in ${year}.`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Towed Units — Tyre Damages ({year})</CardTitle>
          <CardDescription>
            Trailers with 2 or more operational tyre damages in {year}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TireDamageBarChart
            data={trailers}
            emptyMessage={`No trailers had 2 or more operational tyre damages in ${year}.`}
          />
        </CardContent>
      </Card>
    </div>
  )
}
