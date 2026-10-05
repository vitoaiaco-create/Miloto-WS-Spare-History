"use client"

import {
  Fragment,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Printer } from "lucide-react"
import {
  CartesianGrid,
  Label as RechartsLabel,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts"

import {
  upsertMonthlyManualDistance,
  type TireDamagesByFleetType,
} from "@/actions/logistics"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import { TireDamagesCharts } from "@/components/tire-damages-charts"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type {
  LogisticsEntityType,
  MatrixClass,
  MonthlyYieldScore,
  MotiveUnitYieldScore,
  OperatorYieldScore,
  PenaltyDetail,
  ScorecardClass,
} from "@/lib/logistics-scoring"
import {
  SUSPENSION_PENALTY_FAULTS,
  TIRE_PENALTY_CONFIG,
} from "@/lib/penalty-rules"

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

const MONTH_FULL_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

type YtdMonthColumn = { month: number; label: string }

// `endMonth` is the latest *completed* calendar month (see
// `getLatestCompletedMonth` in `src/lib/iso-date.ts`), computed from
// today's date on the server. Building the column list from it (rather
// than a hardcoded Jan–Aug array) keeps the table in sync as new months
// complete.
function buildYtdMonths(endMonth: number): YtdMonthColumn[] {
  return Array.from({ length: endMonth }, (_, index) => ({
    month: index + 1,
    label: MONTH_LABELS[index],
  }))
}

function periodLabelFor(year: number, month: number) {
  return `${MONTH_FULL_NAMES[month - 1]} ${year}`
}

function ytdPeriodLabelFor(year: number, endMonth: number) {
  if (endMonth <= 1) return periodLabelFor(year, endMonth || 1)
  return `${MONTH_FULL_NAMES[0]}–${MONTH_FULL_NAMES[endMonth - 1]} ${year}`
}

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
  rows: {
    rule: string
    score: string
    matrixClass?: MatrixClass
    scoreList?: { label: string; points: number }[]
  }[]
}[] = [
  {
    category: "Distance",
    rows: [
      { rule: "0 – 4,999 km", score: "0 Prize Points" },
      { rule: "5,000 – 6,999 km", score: "+10 Prize Points" },
      { rule: "7,000+ km", score: "+25 Prize Points" },
    ],
  },
  {
    category: "Safe driving stipend",
    rows: [
      { rule: "0 penalty points in the month", score: "+20 pts" },
      { rule: "Any penalty (even −5)", score: "0 pts" },
    ],
  },
  {
    category: "Penalties",
    rows: [
      {
        rule: "Tire damage",
        score: "",
        scoreList: TIRE_PENALTY_CONFIG.map((entry) => ({
          label: entry.damageType,
          points: entry.points,
        })),
      },
      {
        rule: "Suspension job card",
        score: "",
        scoreList: SUSPENSION_PENALTY_FAULTS.map((entry) => ({
          label: entry.fault,
          points: entry.points,
        })),
      },
    ],
  },
  {
    category: "Matrix classes",
    rows: [
      {
        rule: "Class A",
        score: "Average ≥ 12.0 (Requires minimum 7 active months)",
        matrixClass: "Class A",
      },
      {
        rule: "Class B",
        score: "Average 6.0 to 11.9 (or ≥ 12.0 with < 7 active months)",
        matrixClass: "Class B",
      },
      { rule: "Class C", score: "Average 0.0 to 5.9", matrixClass: "Class C" },
      { rule: "Class D", score: "Average < 0.0", matrixClass: "Class D" },
    ],
  },
]

const DIAGNOSTIC_CLASSIFICATION_MATRIX: {
  category: string
  metricBasis: string
  classA: string
  classB: string
  classC: string
  classD: string
}[] = [
  {
    category: "Distance Class",
    metricBasis: "Avg. KM per active month",
    classA: "≥ 6,000 km",
    classB: "5,000 – 5,999 km",
    classC: "4,500 – 4,999 km",
    classD: "< 4,500 km",
  },
  {
    category: "Safety Class",
    metricBasis: "% of active months with Safety pts > 0",
    classA: "≥ 80%",
    classB: "60% – 79.9%",
    classC: "40% – 59.9%",
    classD: "< 40%",
  },
  {
    category: "Truck Penalties",
    metricBasis: "% of active months with 0 penalty pts",
    classA: "≥ 80%",
    classB: "60% – 79.9%",
    classC: "40% – 59.9%",
    classD: "< 40%",
  },
  {
    category: "Trailer Penalties",
    metricBasis: "% of active months with 0 penalty pts",
    classA: "≥ 80%",
    classB: "60% – 79.9%",
    classC: "40% – 59.9%",
    classD: "< 40%",
  },
  {
    category: "Tyre Penalties",
    metricBasis: "Avg. penalty points per active month",
    classA: "0 pts",
    classB: "-0.1 to -4.9 pts",
    classC: "-5.0 to -9.9 pts",
    classD: "≤ -10.0 pts",
  },
  {
    category: "Susp. Penalties",
    metricBasis: "Avg. penalty points per active month",
    classA: "0 pts",
    classB: "-0.1 to -4.9 pts",
    classC: "-5.0 to -9.9 pts",
    classD: "≤ -10.0 pts",
  },
  {
    category: "Overall Class",
    metricBasis: "Total net score average",
    classA: "≥ 20.0 pts",
    classB: "15.0 to 19.9 pts",
    classC: "0.0 to 14.9 pts",
    classD: "< 0.0 pts",
  },
]

function formatKm(km: number) {
  return `${km.toLocaleString("en-US", { maximumFractionDigits: 2 })} km`
}

function formatPoints(points: number) {
  const formatted = points.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return points > 0 ? `+${formatted}` : formatted
}

function formatAverageScore(points: number) {
  const formatted = points.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
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
  return MONTH_LABELS[month - 1] ?? String(month)
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
    typeof point.isEstimated === "boolean" &&
    typeof point.productivityPoints === "number" &&
    typeof point.safeDrivingBonus === "number" &&
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

// Same green/blue/orange/red letter-grade palette as CLASS_BADGE, extended
// with a muted "N/A" for the 6-column scorecard (no active-distance months
// to grade). Used as a full-cell background so the 7-column grid reads as a
// heat map at a glance.
const SCORECARD_CLASS_STYLES: Record<ScorecardClass, string> = {
  "Class A": "bg-green-600 text-white",
  "Class B": "bg-blue-600 text-white",
  "Class C": "bg-orange-500 text-white",
  "Class D": "bg-red-600 text-white",
  "N/A": "bg-muted text-muted-foreground",
}

function scorecardLetter(value: ScorecardClass) {
  return value === "N/A" ? "N/A" : value.slice(-1)
}

function ScorecardCell({ value }: { value: ScorecardClass }) {
  return (
    <TableCell
      className={`text-center text-xs font-semibold ${SCORECARD_CLASS_STYLES[value]}`}
      title={value}
    >
      {scorecardLetter(value)}
    </TableCell>
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
    [
      "Mileage",
      point.isEstimated
        ? `${formatKm(point.totalMileageKm)} (Est.)`
        : formatKm(point.totalMileageKm),
    ],
    ["Distance points", formatPoints(point.productivityPoints)],
    ["Safe driving", formatPoints(point.safeDrivingBonus)],
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

function YieldMatrix({
  data,
  periodLabel,
}: {
  data: MonthlyYieldScore[]
  periodLabel: string
}) {
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
          Net score from −20 to +45 against total mileage for {periodLabel}.
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
            No yield scores for this entity type in {periodLabel}.
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
                domain={[-20, 45]}
                allowDataOverflow
                ticks={[-20, -10, 0, 10, 20, 30, 45]}
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
  averageMonthlyScore: number
  currentClass: MatrixClass
  // 6-column scorecard breakdown (see `gradeScorecard` in logistics-scoring.ts).
  distanceClass: ScorecardClass
  safetyClass: ScorecardClass
  truckPenaltyClass: ScorecardClass
  trailerPenaltyClass: ScorecardClass
  tyrePenaltyClass: ScorecardClass
  suspensionPenaltyClass: ScorecardClass
  monthlyData: Array<{ month: number; netScore: number }>
}

type SortKey =
  | "displayName"
  | "averageMonthlyScore"
  | "currentClass"
  | "distanceClass"
  | "safetyClass"
  | "tyrePenaltyClass"
  | "suspensionPenaltyClass"
type SortDirection = "asc" | "desc"
type SortConfig = { key: SortKey; direction: SortDirection }

const DEFAULT_SORT: SortConfig = {
  key: "averageMonthlyScore",
  direction: "desc",
}

const CLASS_SORT_RANK: Record<ScorecardClass, number> = {
  "Class A": 0,
  "Class B": 1,
  "Class C": 2,
  "Class D": 3,
  "N/A": 4,
}

const CLASS_SORT_KEYS = [
  "currentClass",
  "distanceClass",
  "safetyClass",
  "tyrePenaltyClass",
  "suspensionPenaltyClass",
] as const satisfies readonly SortKey[]

type ClassSortKey = (typeof CLASS_SORT_KEYS)[number]

function isClassSortKey(key: SortKey): key is ClassSortKey {
  return (CLASS_SORT_KEYS as readonly string[]).includes(key)
}

const CLASS_FILTERS = ["All", ...MATRIX_CLASSES] as const

function isClassFilter(value: string | null): value is (typeof CLASS_FILTERS)[number] {
  return value !== null && (CLASS_FILTERS as readonly string[]).includes(value)
}

function compareRankable(a: RankableYield, b: RankableYield, sortConfig: SortConfig) {
  const direction = sortConfig.direction === "asc" ? 1 : -1
  let primary: number

  if (sortConfig.key === "averageMonthlyScore") {
    primary = a.averageMonthlyScore - b.averageMonthlyScore
  } else if (isClassSortKey(sortConfig.key)) {
    primary =
      CLASS_SORT_RANK[a[sortConfig.key]] - CLASS_SORT_RANK[b[sortConfig.key]]
  } else {
    primary = a.displayName.localeCompare(b.displayName)
  }

  if (primary !== 0) return primary * direction
  return a.displayName.localeCompare(b.displayName) || a.id - b.id
}

/**
 * Checks whether `row` matches `query`, searching not just the primary
 * `displayName` (the truck or driver) but also every nested string field
 * inside `row.monthlyData` — e.g. `trailerName`, `trucksOperated`,
 * `trailersPulled`, `driverName`. This lets a search for a trailer's name
 * surface the parent truck row (which can then be expanded to see the
 * matching trailer), even though the trailer isn't the row's own name.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function matchesSearchQuery(row: RankableYield, query: string): boolean {
  if (query.length === 0) return true

  const escapedQuery = escapeRegExp(query)
  const searchRegex = new RegExp(`\\b${escapedQuery}\\b`, "i")

  if (searchRegex.test(row.displayName)) return true

  return row.monthlyData.some((month) =>
    Object.values(month as Record<string, unknown>).some(
      (value) => typeof value === "string" && searchRegex.test(value)
    )
  )
}

function filterAndSortYields<T extends RankableYield>(
  rows: T[],
  searchQuery: string,
  classFilter: string,
  sortConfig: SortConfig
) {
  const query = searchQuery.trim().toLowerCase()

  return rows
    .filter((row) => {
      const matchesSearch = matchesSearchQuery(row, query)
      const matchesClass =
        classFilter === "All" || row.currentClass === classFilter
      return matchesSearch && matchesClass
    })
    .sort((a, b) => compareRankable(a, b, sortConfig))
}

function SortableColumnHead({
  label,
  sortKey,
  sortConfig,
  onSort,
  align = "left",
  title,
}: {
  label: string
  sortKey: SortKey
  sortConfig: SortConfig
  onSort: (key: SortKey) => void
  align?: "left" | "right" | "center"
  title?: string
}) {
  const active = sortConfig.key === sortKey
  const SortIcon = !active
    ? ArrowUpDown
    : sortConfig.direction === "asc"
      ? ArrowUp
      : ArrowDown

  return (
    <TableHead
      className={
        align === "right"
          ? "text-right"
          : align === "center"
            ? "text-center"
            : undefined
      }
      title={title}
      aria-sort={
        active
          ? sortConfig.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <div
        className={
          align === "right"
            ? "flex justify-end"
            : align === "center"
              ? "flex justify-center"
              : undefined
        }
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={
            align === "right"
              ? "-mr-2 h-8 px-2 font-medium print:block print:h-auto print:p-0"
              : align === "center"
                ? "h-8 px-2 font-medium print:block print:h-auto print:p-0"
                : "-ml-2 h-8 px-2 font-medium print:block print:h-auto print:p-0"
          }
          onClick={() => onSort(sortKey)}
        >
          {label}
          <SortIcon
            data-icon="inline-end"
            className={
              active ? "print:hidden" : "opacity-40 print:hidden"
            }
          />
        </Button>
      </div>
    </TableHead>
  )
}

function RankingsMacroTable<T extends RankableYield>({
  data,
  ytdMonths,
  emptyMessage,
  renderDetails,
  sortConfig,
  onSort,
  showMonthlyPoints,
  onShowMonthlyPointsChange,
}: {
  data: T[]
  ytdMonths: YtdMonthColumn[]
  emptyMessage: string
  renderDetails: (row: T) => ReactNode
  sortConfig: SortConfig
  onSort: (key: SortKey) => void
  showMonthlyPoints: boolean
  onShowMonthlyPointsChange: (show: boolean) => void
}) {
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
  const monthlyPointsSwitchId = useId()
  const columnCount = (showMonthlyPoints ? ytdMonths.length : 0) + 9

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 print:hidden">
        <Switch
          id={monthlyPointsSwitchId}
          checked={showMonthlyPoints}
          onCheckedChange={onShowMonthlyPointsChange}
        />
        <Label htmlFor={monthlyPointsSwitchId}>Monthly points</Label>
      </div>
      <Table
        containerClassName="relative w-full max-h-[calc(100vh-250px)] overflow-auto print:max-h-none print:overflow-visible"
      >
        <TableHeader className="sticky top-0 z-10 bg-background shadow-sm [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background">
          <TableRow>
            <SortableColumnHead
              label="Entity Name"
              sortKey="displayName"
              sortConfig={sortConfig}
              onSort={onSort}
            />
            {showMonthlyPoints
              ? ytdMonths.map((column) => (
                  <TableHead key={column.month} className="text-right">
                    {column.label}
                  </TableHead>
                ))
              : null}
            <SortableColumnHead
              label="Avg. Score"
              sortKey="averageMonthlyScore"
              sortConfig={sortConfig}
              onSort={onSort}
              align="right"
            />
            <SortableColumnHead
              label="Dist. Class"
              sortKey="distanceClass"
              sortConfig={sortConfig}
              onSort={onSort}
              align="center"
              title="Distance Class"
            />
            <SortableColumnHead
              label="Safety Class"
              sortKey="safetyClass"
              sortConfig={sortConfig}
              onSort={onSort}
              align="center"
              title="Safety Class"
            />
            <TableHead className="text-center" title="Truck Penalty Class">
              Truck Pen.
            </TableHead>
            <TableHead className="text-center" title="Trailer Penalty Class">
              Trailer Pen.
            </TableHead>
            <SortableColumnHead
              label="Tyre Pen."
              sortKey="tyrePenaltyClass"
              sortConfig={sortConfig}
              onSort={onSort}
              align="center"
              title="Tyre Damages"
            />
            <SortableColumnHead
              label="Susp. Pen."
              sortKey="suspensionPenaltyClass"
              sortConfig={sortConfig}
              onSort={onSort}
              align="center"
              title="Suspension"
            />
            <SortableColumnHead
              label="Overall Class"
              sortKey="currentClass"
              sortConfig={sortConfig}
              onSort={onSort}
              align="center"
              title="Overall Class"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columnCount}
                className="py-10 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            data.map((row) => (
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
                  {showMonthlyPoints
                    ? ytdMonths.map((column) => (
                        <TableCell
                          key={column.month}
                          className="text-right tabular-nums"
                        >
                          {monthNetScore(row.monthlyData, column.month)}
                        </TableCell>
                      ))
                    : null}
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatAverageScore(row.averageMonthlyScore)}
                  </TableCell>
                  <ScorecardCell value={row.distanceClass} />
                  <ScorecardCell value={row.safetyClass} />
                  <ScorecardCell value={row.truckPenaltyClass} />
                  <ScorecardCell value={row.trailerPenaltyClass} />
                  <ScorecardCell value={row.tyrePenaltyClass} />
                  <ScorecardCell value={row.suspensionPenaltyClass} />
                  <ScorecardCell value={row.currentClass} />
                </TableRow>
                {expandedRows[row.id] ? (
                  <TableRow>
                    <TableCell colSpan={columnCount} className="bg-muted/30">
                      {renderDetails(row)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function EstimatedMileageBadge() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className="text-muted-foreground"
          />
        }
      >
        (Est.)
      </TooltipTrigger>
      <TooltipContent>
        Manual estimate — automated odometer data was superseded for this
        month (hardware fault).
      </TooltipContent>
    </Tooltip>
  )
}

function DistanceValue({
  distance,
  isEstimated,
}: {
  distance: number
  isEstimated: boolean
}) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="tabular-nums">
        {distance.toLocaleString("en-US", {
          maximumFractionDigits: 2,
        })}
      </span>
      {isEstimated ? <EstimatedMileageBadge /> : null}
    </span>
  )
}

type MileageOverrideTarget = {
  assetId: number
  assetName: string
  month: number
  rawDistance: number
  currentOverride: number | null
}

function MileageOverrideDialog({
  year,
  target,
  onClose,
}: {
  year: number
  target: MileageOverrideTarget | null
  onClose: () => void
}) {
  const router = useRouter()
  const [distanceInput, setDistanceInput] = useState(
    target?.currentOverride != null ? String(target.currentOverride) : ""
  )
  const [isSaving, setIsSaving] = useState(false)

  const open = target !== null
  const monthLabel = target ? monthName(target.month) : ""

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setDistanceInput("")
      onClose()
    }
  }

  function parseDistance(value: string): number | null {
    const trimmed = value.trim()
    if (trimmed === "") return null
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) return null
    return parsed
  }

  async function saveOverride(manualDistance: number | null) {
    if (!target) return

    setIsSaving(true)
    try {
      await upsertMonthlyManualDistance({
        assetId: target.assetId,
        year,
        month: target.month,
        manualDistance,
      })

      toast.add({
        title:
          manualDistance === null
            ? "Mileage override cleared"
            : "Mileage override saved",
        description:
          manualDistance === null
            ? `${target.assetName} for ${monthLabel} now uses the automated odometer total.`
            : `${target.assetName} for ${monthLabel} now scores on ${manualDistance.toLocaleString("en-US")} km (Est.).`,
        type: "success",
      })
      setDistanceInput("")
      onClose()
      router.refresh()
    } catch (error) {
      toast.add({
        title: "Could not save mileage override",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while saving the estimated distance.",
        type: "error",
      })
    } finally {
      setIsSaving(false)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parseDistance(distanceInput)
    if (parsed === null || !Number.isInteger(parsed) || parsed < 0) {
      toast.add({
        title: "Enter an estimated distance",
        description: "Manual distance must be a whole number of 0 or more.",
        type: "error",
      })
      return
    }

    await saveOverride(parsed)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Override Mileage</DialogTitle>
          <DialogDescription>
            Enter an estimated monthly distance for{" "}
            <span className="font-medium text-foreground">
              {target?.assetName}
            </span>{" "}
            in {monthLabel} {year}. This supersedes the automated odometer
            total for scoring. Raw mileage logs are kept.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Automated odometer total:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {target
                ? `${target.rawDistance.toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })} km`
                : "—"}
            </span>
            {target && target.currentOverride !== null ? (
              <>
                {" "}
                · Current override:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {target.currentOverride.toLocaleString("en-US")} km
                </span>
              </>
            ) : null}
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="manual-distance">Estimated distance (km)</Label>
            <Input
              id="manual-distance"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="e.g. 6500"
              value={distanceInput}
              onChange={(event) => setDistanceInput(event.target.value)}
              required
            />
          </div>
          <DialogFooter>
            {target && target.currentOverride !== null ? (
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => void saveOverride(null)}
              >
                {isSaving ? "Saving…" : "Clear override"}
              </Button>
            ) : null}
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save estimate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MotiveUnitDetails({
  truck,
  year,
}: {
  truck: MotiveUnitYieldScore
  year: number
}) {
  const [overrideTarget, setOverrideTarget] =
    useState<MileageOverrideTarget | null>(null)

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead>Trailer</TableHead>
            <TableHead className="text-right">Distance</TableHead>
            <TableHead className="text-right">Dist. Pts</TableHead>
            <TableHead className="text-right">Safe Driving</TableHead>
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
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <DistanceValue
                    distance={month.distance}
                    isEstimated={month.isEstimated}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="print:hidden text-muted-foreground"
                    aria-label={`Override mileage for ${truck.displayName} in ${monthName(month.month)}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      setOverrideTarget({
                        assetId: truck.id,
                        assetName: truck.displayName,
                        month: month.month,
                        rawDistance: month.rawDistance,
                        currentOverride: month.isEstimated
                          ? Math.round(month.distance)
                          : null,
                      })
                    }}
                  >
                    <Pencil />
                  </Button>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPoints(month.prodPts)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPoints(month.safeDrivingBonus)}
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
      <MileageOverrideDialog
        key={
          overrideTarget
            ? `${overrideTarget.assetId}-${overrideTarget.month}`
            : "closed"
        }
        year={year}
        target={overrideTarget}
        onClose={() => setOverrideTarget(null)}
      />
    </>
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
          <TableHead className="text-right">Dist. Pts</TableHead>
          <TableHead className="text-right">Safe Driving</TableHead>
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
            <TableCell className="text-right">
              <DistanceValue
                distance={month.distance}
                isEstimated={month.isEstimated}
              />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPoints(month.prodPts)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPoints(month.safeDrivingBonus)}
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
  year,
  ytdMonths,
  ytdPeriodLabel,
}: {
  motiveData: MotiveUnitYieldScore[]
  operatorData: OperatorYieldScore[]
  year: number
  ytdMonths: YtdMonthColumn[]
  ytdPeriodLabel: string
}) {
  const [searchQuery, setSearchQuery] = useState("")
  const [classFilter, setClassFilter] = useState("All")
  const [sortConfig, setSortConfig] = useState<SortConfig>(DEFAULT_SORT)
  const [showMonthlyPoints, setShowMonthlyPoints] = useState(true)

  const motiveUnits = useMemo(
    () => filterAndSortYields(motiveData, searchQuery, classFilter, sortConfig),
    [motiveData, searchQuery, classFilter, sortConfig]
  )
  const operators = useMemo(
    () => filterAndSortYields(operatorData, searchQuery, classFilter, sortConfig),
    [operatorData, searchQuery, classFilter, sortConfig]
  )

  function updateSort(key: SortKey) {
    setSortConfig((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "averageMonthlyScore" ? "desc" : "asc" }
    )
  }

  const filtersActive = searchQuery.trim().length > 0 || classFilter !== "All"

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
          Average monthly scores for {ytdPeriodLabel}, sorted by avg. score.
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
      <CardContent className="flex flex-col gap-4">
        <Tabs defaultValue="motive" className="gap-4">
          <TabsList className="grid w-full max-w-[360px] grid-cols-2 print:hidden">
            <TabsTrigger value="motive">Motive Units</TabsTrigger>
            <TabsTrigger value="operators">Operators</TabsTrigger>
          </TabsList>
          <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="logistics-rankings-search">Search</Label>
              <Input
                id="logistics-rankings-search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search Driver, Truck, or Trailer..."
                className="max-w-md"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="logistics-class-filter">Class</Label>
              <Select
                value={classFilter}
                onValueChange={(value) => {
                  if (isClassFilter(value)) setClassFilter(value)
                }}
              >
                <SelectTrigger id="logistics-class-filter" className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLASS_FILTERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <TabsContent value="motive">
            <p className="mb-4 text-sm text-muted-foreground">
              Truck-anchored scores. Trailer penalties follow the truck they
              were paired to.
            </p>
            <RankingsMacroTable
              data={motiveUnits}
              ytdMonths={ytdMonths}
              emptyMessage={
                filtersActive
                  ? "No motive units match the current search or class filter."
                  : `No year-to-date yield scores for ${ytdPeriodLabel}.`
              }
              renderDetails={(truck) => (
                <MotiveUnitDetails truck={truck} year={year} />
              )}
              sortConfig={sortConfig}
              onSort={updateSort}
              showMonthlyPoints={showMonthlyPoints}
              onShowMonthlyPointsChange={setShowMonthlyPoints}
            />
          </TabsContent>
          <TabsContent value="operators">
            <p className="mb-4 text-sm text-muted-foreground">
              Driver-anchored scores. Distance points use the combined valid
              distance across every truck the driver operated that month.
            </p>
            <RankingsMacroTable
              data={operators}
              ytdMonths={ytdMonths}
              emptyMessage={
                filtersActive
                  ? "No operators match the current search or class filter."
                  : `No year-to-date operator scores for ${ytdPeriodLabel}.`
              }
              renderDetails={(driver) => <OperatorDetails driver={driver} />}
              sortConfig={sortConfig}
              onSort={updateSort}
              showMonthlyPoints={showMonthlyPoints}
              onShowMonthlyPointsChange={setShowMonthlyPoints}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function ScoringRuleScoreCell({
  score,
  scoreList,
}: {
  score: string
  scoreList?: { label: string; points: number }[]
}) {
  if (!scoreList || scoreList.length === 0) {
    return <TableCell className="tabular-nums">{score}</TableCell>
  }

  return (
    <TableCell className="tabular-nums">
      <ul className="list-disc space-y-0.5 pl-4">
        {scoreList.map((item) => (
          <li key={item.label}>
            {item.label}: {formatPoints(item.points)} pts
          </li>
        ))}
      </ul>
    </TableCell>
  )
}

function ScoringRules() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scoring Rules</CardTitle>
        <CardDescription>
          Year-to-date class uses the average monthly score across active
          months (distance over 0 km or any penalty). Thresholds are applied
          from the top.
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
                  <ScoringRuleScoreCell
                    score={row.score}
                    scoreList={row.scoreList}
                  />
                </TableRow>
              ))
            )}
          </TableBody>
          <TableCaption className="text-left">
            Monthly net score is distance points plus the safe-driving
            stipend plus penalties. Productivity prize points stack with
            the +20 Safe Driving Stipend, mathematically protecting
            high-volume operators who may incur minor wear-and-tear
            penalties due to extended road exposure.
          </TableCaption>
        </Table>

        <div className="mt-8 space-y-3">
          <div>
            <h3 className="font-heading text-base leading-snug font-medium">
              Diagnostic Classification Matrix
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Note: All percentage and average calculations are based
              strictly on &ldquo;Active Months&rdquo; (months where the asset
              or driver recorded &gt; 0 km). Parked months do not penalize an
              average.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Metric Basis</TableHead>
                <TableHead className="text-center">Class A (Green)</TableHead>
                <TableHead className="text-center">Class B (Blue)</TableHead>
                <TableHead className="text-center">Class C (Orange)</TableHead>
                <TableHead className="text-center">Class D (Red)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DIAGNOSTIC_CLASSIFICATION_MATRIX.map((row) => (
                <TableRow key={row.category}>
                  <TableCell className="font-medium">
                    {row.category}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.metricBasis}
                  </TableCell>
                  <TableCell className="text-center">{row.classA}</TableCell>
                  <TableCell className="text-center">{row.classB}</TableCell>
                  <TableCell className="text-center">{row.classC}</TableCell>
                  <TableCell className="text-center">{row.classD}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

export function LogisticsDashboard({
  data,
  motiveData,
  operatorData,
  tireDamages,
  year,
  month,
}: {
  data: MonthlyYieldScore[]
  motiveData: MotiveUnitYieldScore[]
  operatorData: OperatorYieldScore[]
  tireDamages: TireDamagesByFleetType
  year: number
  /** Latest completed calendar month (1-12); also the YTD end month. */
  month: number
}) {
  const ytdMonths = useMemo(() => buildYtdMonths(month), [month])
  const periodLabel = useMemo(() => periodLabelFor(year, month), [year, month])
  const ytdPeriodLabel = useMemo(
    () => ytdPeriodLabelFor(year, month),
    [year, month]
  )

  return (
    <Tabs defaultValue="matrix" className="gap-6">
      <TabsList className="h-9 w-full max-w-3xl justify-start overflow-x-auto print:hidden group-data-horizontal/tabs:h-9">
        <TabsTrigger className="px-3" value="matrix">
          Yield Matrix (Chart)
        </TabsTrigger>
        <TabsTrigger className="px-3" value="rankings">
          Asset Rankings (Table)
        </TabsTrigger>
        <TabsTrigger className="px-3" value="tyre-damages">
          Tyre Damages
        </TabsTrigger>
        <TabsTrigger className="px-3" value="rules">
          Scoring Rules
        </TabsTrigger>
      </TabsList>
      <TabsContent value="matrix">
        <YieldMatrix data={data} periodLabel={periodLabel} />
      </TabsContent>
      <TabsContent value="rankings">
        <AssetRankings
          motiveData={motiveData}
          operatorData={operatorData}
          year={year}
          ytdMonths={ytdMonths}
          ytdPeriodLabel={ytdPeriodLabel}
        />
      </TabsContent>
      <TabsContent value="tyre-damages">
        <TireDamagesCharts
          trucks={tireDamages.trucks}
          trailers={tireDamages.trailers}
          year={year}
        />
      </TabsContent>
      <TabsContent value="rules">
        <ScoringRules />
      </TabsContent>
    </Tabs>
  )
}
