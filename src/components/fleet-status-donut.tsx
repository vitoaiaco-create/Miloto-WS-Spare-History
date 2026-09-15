"use client"

import { Label, Pie, PieChart } from "recharts"

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
import {
  countFleetOilStatus,
  oilComplianceStatusLabel,
  type OilHealthRow,
} from "@/lib/oil-status"

const STATUS_COLORS = {
  overdue: "var(--destructive)",
  dueSoon: "oklch(0.769 0.164 85)",
  compliant: "oklch(0.645 0.17 155)",
} as const

const chartConfig = {
  trucks: {
    label: "Trucks",
  },
  overdue: {
    label: oilComplianceStatusLabel("overdue"),
    color: STATUS_COLORS.overdue,
  },
  dueSoon: {
    label: oilComplianceStatusLabel("due_soon"),
    color: STATUS_COLORS.dueSoon,
  },
  compliant: {
    label: oilComplianceStatusLabel("compliant"),
    color: STATUS_COLORS.compliant,
  },
} satisfies ChartConfig

const LEGEND_ITEMS = [
  {
    key: "overdue",
    label: oilComplianceStatusLabel("overdue"),
    color: STATUS_COLORS.overdue,
  },
  {
    key: "dueSoon",
    label: oilComplianceStatusLabel("due_soon"),
    color: STATUS_COLORS.dueSoon,
  },
  {
    key: "compliant",
    label: oilComplianceStatusLabel("compliant"),
    color: STATUS_COLORS.compliant,
  },
] as const

export function FleetStatusDonut({ rows }: { rows: OilHealthRow[] }) {
  const counts = countFleetOilStatus(rows)
  const total =
    counts.overdue + counts.dueSoon + counts.compliant

  const chartData = [
    {
      status: "overdue",
      trucks: counts.overdue,
      fill: "var(--color-overdue)",
    },
    {
      status: "dueSoon",
      trucks: counts.dueSoon,
      fill: "var(--color-dueSoon)",
    },
    {
      status: "compliant",
      trucks: counts.compliant,
      fill: "var(--color-compliant)",
    },
  ].filter((slice) => slice.trucks > 0)

  return (
    <Card className="flex flex-col">
      <CardHeader className="items-center pb-0">
        <CardTitle>Fleet Status</CardTitle>
        <CardDescription>
          Oil compliance across the active Miloto fleet
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center justify-center pb-4 sm:flex-row sm:gap-8">
        {total === 0 ? (
          <p className="py-8 text-sm text-muted-foreground">
            No scored fleet assets to chart yet.
          </p>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="mx-auto aspect-square max-h-[220px] w-full min-h-[200px] max-w-[220px]"
          >
            <PieChart accessibilityLayer>
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent hideLabel nameKey="status" />}
              />
              <Pie
                data={chartData}
                dataKey="trucks"
                nameKey="status"
                innerRadius={58}
                strokeWidth={4}
              >
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) {
                      return null
                    }

                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground text-3xl font-bold"
                        >
                          {total.toLocaleString("en-US")}
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy ?? 0) + 22}
                          className="fill-muted-foreground text-sm"
                        >
                          trucks
                        </tspan>
                      </text>
                    )
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
        )}

        <ul className="flex w-full max-w-xs flex-col gap-2 text-sm">
          {LEGEND_ITEMS.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-4"
            >
              <span className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </span>
              <span className="font-medium tabular-nums">
                {counts[item.key].toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
