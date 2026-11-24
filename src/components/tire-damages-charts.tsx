"use client"

import { useMemo, useState } from "react"
import { XIcon } from "lucide-react"
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Label as RechartsLabel,
  XAxis,
  YAxis,
} from "recharts"

import type {
  TireDamageAssetCount,
  TireDamageDriverCount,
} from "@/actions/logistics"
import { TyreDamageDetailsModal } from "@/components/logistics/tyre-damage-details-modal"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Label } from "@/components/ui/label"
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
  damageCount: {
    label: "Incident Count",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

function TireDamageBarChart({
  data,
  emptyMessage,
  onSelect,
}: {
  data: TireDamageAssetCount[]
  emptyMessage: string
  onSelect: (asset: TireDamageAssetCount) => void
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

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
            className="cursor-pointer"
            onClick={(_, index) => {
              const asset = data[index]
              if (asset) onSelect(asset)
            }}
            onMouseEnter={(_, index) => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            {data.map((asset, index) => (
              <Cell
                key={asset.assetName}
                className="cursor-pointer transition-colors"
                fill={
                  hoveredIndex === index
                    ? "var(--primary)"
                    : "var(--color-damageCount)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}

const driverChartConfig = {
  truckDamages: {
    label: "Truck",
    color: "var(--chart-3)",
  },
  trailerDamages: {
    label: "Trailer",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

function DriverTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: TireDamageDriverCount }>
}) {
  const driver = payload?.[0]?.payload
  if (!active || !driver) return null

  return (
    <div className="grid min-w-44 max-w-72 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{driver.driverName}</div>
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Truck</span>
          <span className="font-mono font-medium tabular-nums">
            {driver.truckDamages}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Trailer</span>
          <span className="font-mono font-medium tabular-nums">
            {driver.trailerDamages}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-1">
          <span className="text-muted-foreground">Combined</span>
          <span className="font-mono font-medium tabular-nums">
            {driver.totalDamages}
          </span>
        </div>
      </div>
      {driver.truckIds.length > 0 || driver.trailerIds.length > 0 ? (
        <div className="grid gap-0.5 text-muted-foreground">
          {driver.truckIds.length > 0 ? (
            <span>Trucks: {driver.truckIds.join(", ")}</span>
          ) : null}
          {driver.trailerIds.length > 0 ? (
            <span>Trailers: {driver.trailerIds.join(", ")}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function DriverStackedBarChart({
  data,
  emptyMessage,
  onSelect,
}: {
  data: TireDamageDriverCount[]
  emptyMessage: string
  onSelect: (driver: TireDamageDriverCount) => void
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    )
  }

  // Dim every bar except the hovered one so the highlight keeps the
  // Truck / Trailer colour split readable.
  const opacityFor = (index: number) =>
    hoveredIndex === null || hoveredIndex === index ? 1 : 0.55

  const barHandlers = {
    onClick: (_: unknown, index: number) => {
      const driver = data[index]
      if (driver) onSelect(driver)
    },
    onMouseEnter: (_: unknown, index: number) => setHoveredIndex(index),
    onMouseLeave: () => setHoveredIndex(null),
  }

  return (
    <div className="overflow-x-auto">
      <ChartContainer
        config={driverChartConfig}
        className="aspect-auto h-[400px] w-full"
        style={{ minWidth: Math.max(640, data.length * 56) }}
      >
        <BarChart
          accessibilityLayer
          data={data}
          margin={{ top: 18, right: 16, left: 12, bottom: 8 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="driverName"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval={0}
            angle={-40}
            textAnchor="end"
            height={96}
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
            cursor={false}
            content={<DriverTooltip />}
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="truckDamages"
            stackId="damages"
            fill="var(--color-truckDamages)"
            maxBarSize={48}
            className="cursor-pointer"
            {...barHandlers}
          >
            {data.map((driver, index) => (
              <Cell
                key={driver.driverName}
                className="cursor-pointer transition-opacity"
                fill="var(--color-truckDamages)"
                fillOpacity={opacityFor(index)}
              />
            ))}
          </Bar>
          <Bar
            dataKey="trailerDamages"
            stackId="damages"
            fill="var(--color-trailerDamages)"
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
            className="cursor-pointer"
            {...barHandlers}
          >
            {data.map((driver, index) => (
              <Cell
                key={driver.driverName}
                className="cursor-pointer transition-opacity"
                fill="var(--color-trailerDamages)"
                fillOpacity={opacityFor(index)}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  )
}

const ALL_DRIVERS_LABEL = "All Drivers"

type ViewMode = "asset" | "driver"

const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "asset", label: "By Asset (Trucks & Trailers)" },
  { value: "driver", label: "By Driver (Combined)" },
]

// Tyre Damages tab of the Logistics Analytics dashboard. Default view is
// two bar charts — Motive Units (Trucks) and Towed Units (Trailers) — fed
// by `getTireDamagesByAsset` (src/actions/logistics.ts), which restricts
// each dataset to assets with 2+ operational tyre damages for the year and
// excludes Cranes. The "By Driver (Combined)" view stacks Truck + Trailer
// damages per driver (`getTireDamagesByDriver`) and is also what a specific
// Driver filter selection renders.
export function TireDamagesCharts({
  trucks,
  trailers,
  drivers,
  year,
}: {
  trucks: TireDamageAssetCount[]
  trailers: TireDamageAssetCount[]
  drivers: TireDamageDriverCount[]
  year: number
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("asset")
  const [driverFilter, setDriverFilter] = useState(ALL_DRIVERS_LABEL)
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [selectedDriverName, setSelectedDriverName] = useState<string | null>(
    null
  )
  const [modalOpen, setModalOpen] = useState(false)

  const driverSelected = driverFilter !== ALL_DRIVERS_LABEL

  const driverOptions = useMemo(
    () => [
      ALL_DRIVERS_LABEL,
      ...drivers
        .map((driver) => driver.driverName)
        .sort((a, b) => a.localeCompare(b)),
    ],
    [drivers]
  )

  const driverChartData = useMemo(() => {
    if (driverSelected) {
      // A specific driver is always shown, whatever their damage count.
      return drivers.filter(
        (driver) =>
          driver.driverName === driverFilter && driver.totalDamages > 0
      )
    }
    return drivers.filter((driver) => driver.totalDamages >= 2)
  }, [drivers, driverFilter, driverSelected])

  function openAssetDetails(asset: TireDamageAssetCount) {
    setSelectedDriverName(null)
    setSelectedAssetId(asset.assetId)
    setModalOpen(true)
  }

  function openDriverDetails(driver: TireDamageDriverCount) {
    setSelectedAssetId(null)
    setSelectedDriverName(driver.driverName)
    setModalOpen(true)
  }

  function handleViewModeChange(next: ViewMode) {
    setViewMode(next)
    // The asset view has no per-driver filtering, so leaving the driver
    // view resets the filter back to the full fleet.
    if (next === "asset") setDriverFilter(ALL_DRIVERS_LABEL)
  }

  function handleDriverChange(value: string | null) {
    const next = value && value.length > 0 ? value : ALL_DRIVERS_LABEL
    setDriverFilter(next)
    // Picking a specific driver shows their combined Truck + Trailer chart.
    if (next !== ALL_DRIVERS_LABEL) setViewMode("driver")
  }

  return (
    <div className="flex flex-col gap-6">
      <TyreDamageDetailsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        year={year}
        assetId={selectedAssetId}
        driverName={selectedDriverName}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm leading-none font-medium">View</span>
          <div
            role="group"
            aria-label="Tyre damages view mode"
            className="flex flex-wrap items-center gap-1.5"
          >
            {VIEW_MODES.map((mode) => (
              <Button
                key={mode.value}
                type="button"
                size="sm"
                variant={viewMode === mode.value ? "default" : "outline"}
                aria-pressed={viewMode === mode.value}
                onClick={() => handleViewModeChange(mode.value)}
              >
                {mode.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tyre-damages-driver-filter">Driver</Label>
          <div className="flex items-center gap-1.5">
            <Combobox
              items={driverOptions}
              value={driverFilter}
              onValueChange={handleDriverChange}
              autoHighlight
            >
              <ComboboxInput
                id="tyre-damages-driver-filter"
                placeholder="Search drivers..."
                className="w-[220px]"
              />
              <ComboboxContent>
                <ComboboxEmpty>No drivers found.</ComboboxEmpty>
                <ComboboxList>
                  {(item: string) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            {driverSelected ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDriverFilter(ALL_DRIVERS_LABEL)}
              >
                <XIcon />
                Clear / All Drivers
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {viewMode === "driver" ? (
        <Card>
          <CardHeader>
            <CardTitle>Drivers — Combined Tyre Damages ({year})</CardTitle>
            <CardDescription>
              {driverSelected
                ? `Combined operational tyre damages (Truck + Trailer) for ${driverFilter} in ${year}. Click the bar for incident details & WhatsApp share.`
                : `Drivers with 2 or more combined operational tyre damages (Truck + Trailer) in ${year}. Click any bar for incident details & WhatsApp share.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DriverStackedBarChart
              data={driverChartData}
              onSelect={openDriverDetails}
              emptyMessage={
                driverSelected
                  ? `${driverFilter} had no operational tyre damages in ${year}.`
                  : `No drivers had 2 or more combined operational tyre damages in ${year}.`
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Motive Units — Tyre Damages ({year})</CardTitle>
              <CardDescription>
                Trucks with 2 or more operational tyre damages in {year}. Click
                any bar for incident details &amp; WhatsApp share.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TireDamageBarChart
                data={trucks}
                onSelect={openAssetDetails}
                emptyMessage={`No trucks had 2 or more operational tyre damages in ${year}.`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Towed Units — Tyre Damages ({year})</CardTitle>
              <CardDescription>
                Trailers with 2 or more operational tyre damages in {year}.
                Click any bar for incident details &amp; WhatsApp share.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TireDamageBarChart
                data={trailers}
                onSelect={openAssetDetails}
                emptyMessage={`No trailers had 2 or more operational tyre damages in ${year}.`}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
