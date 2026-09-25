"use client"

import { Fragment, useMemo, useState, type ReactNode } from "react"
import { Printer } from "lucide-react"
import {
  CartesianGrid,
  Label as RechartsLabel,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  type ChartConfig,
} from "@/components/ui/chart"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  LogisticsEntityType,
  MatrixClass,
  MonthlyYieldScore,
  MotiveUnitYieldScore,
  OperatorYieldScore,
  PenaltyDetail,
} from "@/lib/logistics-scoring"

const PERIOD_LABEL = "September 2026"
const YTD_PERIOD_LABEL = "January–August 2026"

const YTD_MONTHS = [
  { month: 1, label: "Jan" },
  { month: 2, label: "Feb" },
  { month: 3, label: "Mar" },
  { month: 4, label: "Apr" },
  { month: 5, label: "May" },
  { month: 6, label: "Jun" },
  { month: 7, label: "Jul" },
  { month: 8, label: "Aug" },
] as const

const MATRIX_CLASSES = [
  "Class A",
  "Class B",
  "Class C",
  "Class D",
] as const satisfies readonly MatrixClass[]

const CLASS_FILL: Record<MatrixClass, string> = {
  "Class A": "#16a34a",
  "Class B": "#2563eb",
  "Class C": "#ea580c",
  "Class D": "#dc2626",
}

const CLASS_BADGE: Record<MatrixClass, string> = {
  "Class A": "border-transparent bg-green-600 text-white",
  "Class B": "border-transparent bg-blue-600 text-white",
  "Class C": "border-transparent bg-orange-500 text-white",
  "Class D": "border-transparent bg-red-600 text-white",
}

const CLASS_DETAIL: Record<MatrixClass, string> = {
  "Class A": "High yield",
  "Class B": "Target",
  "Class C": "Underperforming",
  "Class D": "Liability",
}

const chartConfig = {
  classA: { label: "Class A", color: CLASS_FILL["Class A"] },
  classB: { label: "Class B", color: CLASS_FILL["Class B"] },
  classC: { label: "Class C", color: CLASS_FILL["Class C"] },
  classD: { label: "Class D", color: CLASS_FILL["Class D"] },
} satisfies ChartConfig

type EntityFilter = "all" | LogisticsEntityType

const ENTITY_FILTERS: { value: EntityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "Truck", label: "Trucks" },
  { value: "Trailer", label: "Trailers" },
  { value: "Driver", label: "Drivers" },
]

const SCORING_RULES: {
  category: string
  rows: { rule: string; score: string; matrixClass?: MatrixClass }[]
}[] = [
  {
    category: "Productivity",
    rows: [
      { rule: "< 4,000 km", score: "0 pts" },
      { rule: "4,001–6,000 km", score: "+10 pts" },
      { rule: "> 6,000 km", score: "+20 pts" },
    ],
  },
  {
    category: "Penalties",
    rows: [
      { rule: "Tire damage", score: "Variable based on type" },
      { rule: "Suspension job card", score: "−5 pts per card" },
    ],
  },
  {
    category: "Matrix classes",
    rows: [
      { rule: "Class A", score: "≥ 15 pts", matrixClass: "Class A" },
      { rule: "Class B", score: "≥ 10 pts", matrixClass: "Class B" },
      { rule: "Class C", score: "≥ 0 pts", matrixClass: "Class C" },
      { rule: "Class D", score: "< 0 pts", matrixClass: "Class D" },
    ],
  },
]

function formatKm(km: number) {
  return `${km.toLocaleString("en-US", { maximumFractionDigits: 2 })} km`
}

function formatPoints(points: number) {
  const formatted = points.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return points > 0 ? `+${formatted}` : formatted
}

function monthNetScore(
  monthlyData: Array<{ month: number; netScore: number }>,
  month: number
) {
  const row = monthlyData.find((entry) => entry.month === month)
  return row ? formatPoints(row.netScore) : "-"
}

function monthName(month: number) {
  return YTD_MONTHS.find((column) => column.month === month)?.label ?? String(month)
}

function isEntityFilter(value: string | null): value is EntityFilter {
  return (
    value === "all" ||
    value === "Truck" ||
    value === "Trailer" ||
    value === "Driver"
  )
}

function isYieldScore(value: unknown): value is MonthlyYieldScore {
  if (!value || typeof value !== "object") return false

  const point = value as Partial<MonthlyYieldScore>
  return (
    (point.entityType === "Truck" ||
      point.entityType === "Trailer" ||
      point.entityType === "Driver") &&
    typeof point.name === "string" &&
    typeof point.totalMileageKm === "number" &&
    typeof point.productivityPoints === "number" &&
    typeof point.tirePenaltyPoints === "number" &&
    typeof point.suspensionPenaltyPoints === "number" &&
    typeof point.netScore === "number" &&
    (point.matrixClass === "Class A" ||
      point.matrixClass === "Class B" ||
      point.matrixClass === "Class C" ||
      point.matrixClass === "Class D")
  )
}

function ClassBadge({ matrixClass }: { matrixClass: MatrixClass }) {
  return (
    <Badge className={CLASS_BADGE[matrixClass]}>{matrixClass}</Badge>
  )
}

function PenaltyPopover({
  amount,
  details,
}: {
  amount: number
  details: PenaltyDetail[]
}) {
  if (amount === 0) {
    return <span>0</span>
  }

  if (amount < 0) {
    return (
      <Popover>
        <PopoverTrigger
          className="cursor-help font-semibold text-red-600 underline decoration-dotted"
          render={<span />}
        >
          {formatPoints(amount)}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="max-h-64 w-72 overflow-y-auto"
        >
          <ul className="space-y-1.5 text-xs">
            {details.map((detail, index) => (
              <li
                key={`${detail.date}-${detail.reason}-${detail.visualId ?? ""}-${index}`}
                className="flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-muted-foreground">{detail.date}</div>
                  <div>
                    {detail.reason}
                    {detail.visualId ? ` (${detail.visualId})` : null}
                  </div>
                </div>
                <span className="shrink-0 font-medium tabular-nums text-red-600">
                  {formatPoints(detail.amount)}
                </span>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    )
  }

  return <span>{formatPoints(amount)}</span>
}

function YieldDot({
  cx,
  cy,
  payload,
}: {
  cx?: number
  cy?: number
  payload?: MonthlyYieldScore
}) {
  if (typeof cx !== "number" || typeof cy !== "number" || !isYieldScore(payload)) {
    return <g />
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={6}
      fill={CLASS_FILL[payload.matrixClass]}
      stroke="var(--background)"
      strokeWidth={1.5}
    />
  )
}

function YieldTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: unknown }>
}) {
  const point = payload?.[0]?.payload
  if (!active || !isYieldScore(point)) return null

  const rows = [
    ["Mileage", formatKm(point.totalMileageKm)],
    ["Productivity", formatPoints(point.productivityPoints)],
    ["Tire penalty", formatPoints(point.tirePenaltyPoints)],
    ["Suspension penalty", formatPoints(point.suspensionPenaltyPoints)],
    ["Net score", formatPoints(point.netScore)],
  ] as const

  return (
    <div className="grid min-w-52 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-2 text-xs shadow-xl">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{point.name}</span>
        <ClassBadge matrixClass={point.matrixClass} />
      </div>
      <p className="text-muted-foreground">{point.entityType}</p>
      <dl className="grid gap-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono font-medium text-foreground tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function YieldMatrix({ data }: { data: MonthlyYieldScore[] }) {
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all")
  const points = useMemo(
    () =>
      entityFilter === "all"
        ? data
        : data.filter((score) => score.entityType === entityFilter),
    [data, entityFilter]
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Yield Matrix (Chart)</CardTitle>
        <CardDescription>
          Net score from −20 to +20 against total mileage for {PERIOD_LABEL}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="logistics-entity-type">Entity type</Label>
            <Select
              value={entityFilter}
              onValueChange={(value) => {
                if (isEntityFilter(value)) setEntityFilter(value)
              }}
            >
              <SelectTrigger id="logistics-entity-type" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_FILTERS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {MATRIX_CLASSES.map((matrixClass) => (
              <li key={matrixClass} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: CLASS_FILL[matrixClass] }}
                />
                {matrixClass}
              </li>
            ))}
          </ul>
        </div>

        {points.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No yield scores for this entity type in {PERIOD_LABEL}.
          </p>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[420px] w-full"
          >
            <ScatterChart margin={{ top: 12, right: 16, bottom: 28, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="netScore"
                name="Net score"
                domain={[-20, 20]}
                allowDataOverflow
                ticks={[-20, -10, 0, 10, 20]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              >
                <RechartsLabel
                  value="Net score"
                  position="bottom"
                  offset={12}
                  style={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                />
              </XAxis>
              <YAxis
                type="number"
                dataKey="totalMileageKm"
                name="Total mileage"
                domain={[0, "auto"]}
                width={72}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value: number) =>
                  Number(value).toLocaleString("en-US", {
                    maximumFractionDigits: 0,
                  })
                }
              >
                <RechartsLabel
                  value="Total mileage"
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
              <ZAxis range={[80, 80]} />
              <ChartTooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={<YieldTooltip />}
              />
              <Scatter data={points} shape={<YieldDot />} />
            </ScatterChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

type RankableYield = {
  id: number
  displayName: string
  ytdNetScore: number
  currentClass: MatrixClass
  monthlyData: Array<{ month: number; netScore: number }>
}

function RankingsMacroTable<T extends RankableYield>({
  data,
  emptyMessage,
  renderDetails,
}: {
  data: T[]
  emptyMessage: string
  renderDetails: (row: T) => ReactNode
}) {
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
  const ranked = useMemo(
    () =>
      [...data].sort(
        (a, b) =>
          b.ytdNetScore - a.ytdNetScore ||
          a.displayName.localeCompare(b.displayName) ||
          a.id - b.id
      ),
    [data]
  )

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Entity Name</TableHead>
          {YTD_MONTHS.map((column) => (
            <TableHead key={column.month} className="text-right">
              {column.label}
            </TableHead>
          ))}
          <TableHead className="text-right">YTD Score</TableHead>
          <TableHead>Current Class</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ranked.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={YTD_MONTHS.length + 3}
              className="py-10 text-center text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          ranked.map((row) => (
            <Fragment key={row.id}>
              <TableRow
                className="cursor-pointer hover:bg-muted/50"
                onClick={() =>
                  setExpandedRows((prev) => ({
                    ...prev,
                    [row.id]: !prev[row.id],
                  }))
                }
              >
                <TableCell className="font-medium">{row.displayName}</TableCell>
                {YTD_MONTHS.map((column) => (
                  <TableCell
                    key={column.month}
                    className="text-right tabular-nums"
                  >
                    {monthNetScore(row.monthlyData, column.month)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium tabular-nums">
                  {formatPoints(row.ytdNetScore)}
                </TableCell>
                <TableCell>
                  <ClassBadge matrixClass={row.currentClass} />
                </TableCell>
              </TableRow>
              {expandedRows[row.id] ? (
                <TableRow>
                  <TableCell
                    colSpan={YTD_MONTHS.length + 3}
                    className="bg-muted/30"
                  >
                    {renderDetails(row)}
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function MotiveUnitDetails({ truck }: { truck: MotiveUnitYieldScore }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Driver</TableHead>
          <TableHead>Trailer</TableHead>
          <TableHead className="text-right">Distance</TableHead>
          <TableHead className="text-right">Prod Pts</TableHead>
          <TableHead className="text-right">Truck Pen.</TableHead>
          <TableHead className="text-right">Trailer Pen.</TableHead>
          <TableHead className="text-right">Net Pts</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {truck.monthlyData.map((month) => (
          <TableRow key={month.month}>
            <TableCell>{monthName(month.month)}</TableCell>
            <TableCell>{month.driverName || "—"}</TableCell>
            <TableCell>{month.trailerName || "—"}</TableCell>
            <TableCell className="text-right tabular-nums">
              {month.distance.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPoints(month.prodPts)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <PenaltyPopover
                amount={month.truckPen}
                details={month.truckPenaltyDetails}
              />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <PenaltyPopover
                amount={month.trailerPen}
                details={month.trailerPenaltyDetails}
              />
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatPoints(month.netScore)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function OperatorDetails({ driver }: { driver: OperatorYieldScore }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Truck(s)</TableHead>
          <TableHead>Trailer(s)</TableHead>
          <TableHead className="text-right">Distance</TableHead>
          <TableHead className="text-right">Prod Pts</TableHead>
          <TableHead className="text-right">Penalties</TableHead>
          <TableHead className="text-right">Net Pts</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {driver.monthlyData.map((month) => (
          <TableRow key={month.month}>
            <TableCell>{monthName(month.month)}</TableCell>
            <TableCell>{month.trucksOperated || "—"}</TableCell>
            <TableCell>{month.trailersPulled || "—"}</TableCell>
            <TableCell className="text-right tabular-nums">
              {month.distance.toLocaleString("en-US", {
                maximumFractionDigits: 2,
              })}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPoints(month.prodPts)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <PenaltyPopover
                amount={month.penalties}
                details={month.penaltyDetails}
              />
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatPoints(month.netScore)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function AssetRankings({
  motiveData,
  operatorData,
}: {
  motiveData: MotiveUnitYieldScore[]
  operatorData: OperatorYieldScore[]
}) {
  return (
    <Card id="logistics-asset-rankings">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #logistics-asset-rankings,
          #logistics-asset-rankings * { visibility: visible; }
          #logistics-asset-rankings {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            overflow: visible;
            box-shadow: none;
          }
        }
      `}</style>
      <CardHeader>
        <CardTitle>Asset Rankings (Table)</CardTitle>
        <CardDescription>
          Year-to-date net scores for {YTD_PERIOD_LABEL}, sorted by YTD score.
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            className="print:hidden"
            onClick={() => window.print()}
          >
            <Printer data-icon="inline-start" />
            Print
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 overflow-x-auto">
        <Tabs defaultValue="motive" className="gap-4">
          <TabsList className="grid w-full max-w-[360px] grid-cols-2">
            <TabsTrigger value="motive">Motive Units</TabsTrigger>
            <TabsTrigger value="operators">Operators</TabsTrigger>
          </TabsList>
          <TabsContent value="motive">
            <p className="mb-4 text-sm text-muted-foreground">
              Truck-anchored scores. Trailer penalties follow the truck they
              were paired to.
            </p>
            <RankingsMacroTable
              data={motiveData}
              emptyMessage={`No year-to-date yield scores for ${YTD_PERIOD_LABEL}.`}
              renderDetails={(truck) => <MotiveUnitDetails truck={truck} />}
            />
          </TabsContent>
          <TabsContent value="operators">
            <p className="mb-4 text-sm text-muted-foreground">
              Driver-anchored scores. Productivity uses the combined valid
              distance across every truck the driver operated that month.
            </p>
            <RankingsMacroTable
              data={operatorData}
              emptyMessage={`No year-to-date operator scores for ${YTD_PERIOD_LABEL}.`}
              renderDetails={(driver) => <OperatorDetails driver={driver} />}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function ScoringRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scoring Rules</CardTitle>
        <CardDescription>
          Classes are assigned from the top. A net score takes the first
          threshold it meets.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SCORING_RULES.map((group) =>
              group.rows.map((row, index) => (
                <TableRow key={`${group.category}-${row.rule}`}>
                  {index === 0 ? (
                    <TableCell
                      rowSpan={group.rows.length}
                      className="align-top font-medium"
                    >
                      {group.category}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    {row.matrixClass ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <ClassBadge matrixClass={row.matrixClass} />
                        <span className="text-muted-foreground">
                          {CLASS_DETAIL[row.matrixClass]}
                        </span>
                      </span>
                    ) : (
                      row.rule
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{row.score}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <TableCaption className="text-left">
            Net score is productivity points plus penalty points.
          </TableCaption>
        </Table>
      </CardContent>
    </Card>
  )
}

export function LogisticsDashboard({
  data,
  motiveData,
  operatorData,
}: {
  data: MonthlyYieldScore[]
  motiveData: MotiveUnitYieldScore[]
  operatorData: OperatorYieldScore[]
}) {
  return (
    <Tabs defaultValue="matrix" className="gap-6">
      <TabsList className="h-9 w-full max-w-3xl justify-start overflow-x-auto group-data-horizontal/tabs:h-9">
        <TabsTrigger className="px-3" value="matrix">
          Yield Matrix (Chart)
        </TabsTrigger>
        <TabsTrigger className="px-3" value="rankings">
          Asset Rankings (Table)
        </TabsTrigger>
        <TabsTrigger className="px-3" value="rules">
          Scoring Rules
        </TabsTrigger>
      </TabsList>
      <TabsContent value="matrix">
        <YieldMatrix data={data} />
      </TabsContent>
      <TabsContent value="rankings">
        <AssetRankings
          motiveData={motiveData}
          operatorData={operatorData}
        />
      </TabsContent>
      <TabsContent value="rules">
        <ScoringRules />
      </TabsContent>
    </Tabs>
  )
}
