"use client"

import {
  type SpendPacing,
  type YtdAnalytics,
  type YtdAnalyticsPoint,
} from "@/actions/analytics"
import { AnalyticsCpkChart } from "@/components/analytics-cpk-chart"
import { MomDataTable } from "@/components/mom-data-table"
import { SpendPacingDashboard } from "@/components/spend-pacing-dashboard"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type AnalyticsViewProps = {
  cpkData: YtdAnalyticsPoint[]
  avgTotalUsd: number | null
  avgCpk: number | null
  spendPacing: SpendPacing
}

function FleetAnalyticsView({
  cpkData,
  avgTotalUsd,
  avgCpk,
  spendPacing,
}: AnalyticsViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <MomDataTable
        data={cpkData}
        fleetKm={cpkData.map(({ month, totalKm }) => ({ month, totalKm }))}
      />
      <AnalyticsCpkChart
        data={cpkData}
        avgTotalUsd={avgTotalUsd}
        avgCpk={avgCpk}
      />
      <SpendPacingDashboard {...spendPacing} />
    </div>
  )
}

export function AnalyticsDashboard({
  combinedCpk,
  motiveCpk,
  towedCpk,
  combinedPacing,
  motivePacing,
  towedPacing,
}: {
  combinedCpk: YtdAnalytics
  motiveCpk: YtdAnalytics
  towedCpk: YtdAnalytics
  combinedPacing: SpendPacing
  motivePacing: SpendPacing
  towedPacing: SpendPacing
}) {
  const combinedViewProps: AnalyticsViewProps = {
    cpkData: combinedCpk.months,
    avgTotalUsd: combinedCpk.avgTotalUsd,
    avgCpk: combinedCpk.avgCpk,
    spendPacing: combinedPacing,
  }
  const motiveViewProps: AnalyticsViewProps = {
    cpkData: motiveCpk.months,
    avgTotalUsd: motiveCpk.avgTotalUsd,
    avgCpk: motiveCpk.avgCpk,
    spendPacing: motivePacing,
  }
  const towedViewProps: AnalyticsViewProps = {
    cpkData: towedCpk.months,
    avgTotalUsd: towedCpk.avgTotalUsd,
    avgCpk: towedCpk.avgCpk,
    spendPacing: towedPacing,
  }

  return (
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
  )
}
