"use client"

import { useState, type FormEvent } from "react"
import { usePathname, useRouter } from "next/navigation"

import {
  upsertMonthlyFleetKm,
  type SpendPacing,
  type YtdAnalytics,
} from "@/actions/analytics"
import {
  AnalyticsCpkChart,
  type AnalyticsCpkPoint,
} from "@/components/analytics-cpk-chart"
import { SpendPacingDashboard } from "@/components/spend-pacing-dashboard"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"

export type AnalyticsViewProps = {
  selectedMonth: string
  fleetKm: number | null
  cpkData: AnalyticsCpkPoint[]
  avgTotalUsd: number | null
  avgCpk: number | null
  spendPacing: SpendPacing
}

function parseFleetKm(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === "") return null

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null

  return parsed
}

function parseSelectedMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null

  return { year, month }
}

function FleetAnalyticsView({
  cpkData,
  avgTotalUsd,
  avgCpk,
  spendPacing,
}: AnalyticsViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <AnalyticsCpkChart
        data={cpkData}
        avgTotalUsd={avgTotalUsd}
        avgCpk={avgCpk}
      />
      <SpendPacingDashboard
        dailyPacing={spendPacing.dailyPacing}
        weeklyPacing={spendPacing.weeklyPacing}
      />
    </div>
  )
}

export function AnalyticsDashboard({
  selectedMonth,
  combinedCpk,
  motiveCpk,
  towedCpk,
  combinedPacing,
  motivePacing,
  towedPacing,
}: {
  selectedMonth: string
  combinedCpk: YtdAnalytics
  motiveCpk: YtdAnalytics
  towedCpk: YtdAnalytics
  combinedPacing: SpendPacing
  motivePacing: SpendPacing
  towedPacing: SpendPacing
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [fleetKmInput, setFleetKmInput] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const fleetKm = parseFleetKm(fleetKmInput)
  const combinedViewProps: AnalyticsViewProps = {
    selectedMonth,
    fleetKm,
    cpkData: combinedCpk.months,
    avgTotalUsd: combinedCpk.avgTotalUsd,
    avgCpk: combinedCpk.avgCpk,
    spendPacing: combinedPacing,
  }
  const motiveViewProps: AnalyticsViewProps = {
    selectedMonth,
    fleetKm,
    cpkData: motiveCpk.months,
    avgTotalUsd: motiveCpk.avgTotalUsd,
    avgCpk: motiveCpk.avgCpk,
    spendPacing: motivePacing,
  }
  const towedViewProps: AnalyticsViewProps = {
    selectedMonth,
    fleetKm,
    cpkData: towedCpk.months,
    avgTotalUsd: towedCpk.avgTotalUsd,
    avgCpk: towedCpk.avgCpk,
    spendPacing: towedPacing,
  }

  function onSelectedMonthChange(value: string) {
    router.replace(value ? `${pathname}?month=${value}` : pathname, {
      scroll: false,
    })
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const monthParts = parseSelectedMonth(selectedMonth)
    if (!monthParts) {
      toast.add({
        title: "Choose a month",
        description: "Select the calendar month this fleet KM total belongs to.",
        type: "error",
      })
      return
    }

    if (fleetKm === null || !Number.isInteger(fleetKm) || fleetKm < 0) {
      toast.add({
        title: "Enter total fleet KM",
        description: "Total Fleet KM must be a whole number of 0 or more.",
        type: "error",
      })
      return
    }

    setIsSaving(true)

    try {
      const row = await upsertMonthlyFleetKm({
        year: monthParts.year,
        month: monthParts.month,
        totalKm: fleetKm,
      })

      toast.add({
        title: "Fleet KM saved",
        description: `Stored ${row.totalKm.toLocaleString()} km for ${selectedMonth}.`,
        type: "success",
      })
    } catch (error) {
      toast.add({
        title: "Could not save fleet KM",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while saving the monthly fleet KM.",
        type: "error",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Total Fleet KM</CardTitle>
          <CardDescription>
            Enter the fleet-wide kilometres for a calendar month. Saving
            overwrites any total already stored for that month.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={onSubmit}
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="analytics-month">Month</Label>
              <Input
                id="analytics-month"
                type="month"
                value={selectedMonth}
                onChange={(event) => onSelectedMonthChange(event.target.value)}
                required
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="analytics-fleet-km">Total Fleet KM</Label>
              <Input
                id="analytics-fleet-km"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder="e.g. 125000"
                value={fleetKmInput}
                onChange={(event) => setFleetKmInput(event.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Tabs defaultValue="combined" className="gap-6">
        <TabsList className="grid w-full max-w-[400px] grid-cols-3">
          <TabsTrigger className="px-6 text-base" value="combined">
            All Miloto
          </TabsTrigger>
          <TabsTrigger className="px-6 text-base" value="motive">
            Trucks
          </TabsTrigger>
          <TabsTrigger className="px-6 text-base" value="towed">
            Trailers
          </TabsTrigger>
        </TabsList>
        <TabsContent value="combined">
          <FleetAnalyticsView {...combinedViewProps} />
        </TabsContent>
        <TabsContent value="motive">
          <FleetAnalyticsView {...motiveViewProps} />
        </TabsContent>
        <TabsContent value="towed">
          <FleetAnalyticsView {...towedViewProps} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
