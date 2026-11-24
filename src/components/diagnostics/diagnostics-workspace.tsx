"use client"

import { useRouter } from "next/navigation"
import { useCallback, useMemo, useState } from "react"
import { format } from "date-fns"
import { X } from "lucide-react"

import {
  SeverityBadge,
  WorkflowStatusBadge,
} from "@/components/diagnostics/diagnostics-badges"
import { FleetCoverageView } from "@/components/diagnostics/fleet-coverage-view"
import { FleetFaultIntelligence } from "@/components/diagnostics/fleet-fault-intelligence"
import { NewPttScanPanel } from "@/components/diagnostics/new-ptt-scan-panel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  isOpenDirective,
  latestSessionByFleet,
  normalizeFleetId,
} from "@/lib/ptt-diagnostics"
import type {
  PttSessionWithRelations,
  RecurringFault,
} from "@/lib/ptt-diagnostics-queries"
import { cn } from "@/lib/utils"

type TabValue = "coverage" | "scan" | "intelligence"

export function DiagnosticsWorkspace({
  rosterFleetIds,
  sessions,
  recurringFaults,
}: {
  rosterFleetIds: string[]
  sessions: PttSessionWithRelations[]
  recurringFaults: RecurringFault[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<TabValue>("coverage")
  const [scanFleetId, setScanFleetId] = useState<string | null>(null)
  // Ready for the Executive Directive modal: it will read this state.
  const [selectedSession, setSelectedSession] =
    useState<PttSessionWithRelations | null>(null)

  const latestByFleet = useMemo(
    () => latestSessionByFleet(sessions),
    [sessions]
  )

  const kpis = useMemo(() => {
    let scanned = 0
    let critical = 0
    let calibrationOnly = 0
    let openDirectives = 0

    for (const fleetId of rosterFleetIds) {
      const latest = latestByFleet.get(fleetId)
      if (!latest) continue
      scanned += 1
      if (latest.overallSeverity === "CRITICAL") critical += 1
      if (latest.overallSeverity === "CALIBRATION_ONLY") calibrationOnly += 1
      if (isOpenDirective(latest)) openDirectives += 1
    }

    const total = rosterFleetIds.length
    return {
      scanned,
      total,
      percent: total === 0 ? 0 : Math.round((scanned / total) * 100),
      critical,
      calibrationOnly,
      openDirectives,
    }
  }, [rosterFleetIds, latestByFleet])

  const openDirective = useCallback((session: PttSessionWithRelations) => {
    setSelectedSession(session)
  }, [])

  const openFleetDirective = useCallback(
    (fleetId: string) => {
      const latest = latestByFleet.get(normalizeFleetId(fleetId))
      if (latest) setSelectedSession(latest)
    },
    [latestByFleet]
  )

  const startScan = useCallback((fleetId: string | null) => {
    setScanFleetId(fleetId)
    setTab("scan")
  }, [])

  const handleScanComplete = useCallback(() => {
    setScanFleetId(null)
    setTab("coverage")
    // Re-run the server reads so the new scan shows up in coverage.
    router.refresh()
  }, [router])

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm" className="sm:col-span-2 lg:col-span-1">
          <CardHeader>
            <CardDescription>Sweep Progress</CardDescription>
            <CardTitle className="text-xl tabular-nums">
              {kpis.scanned} / {kpis.total} Trucks Scanned{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({kpis.percent}%)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              role="progressbar"
              aria-label="Fleet scan progress"
              aria-valuemin={0}
              aria-valuemax={kpis.total}
              aria-valuenow={kpis.scanned}
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${kpis.percent}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <KpiCard
          label="Critical / Stop-Work"
          value={kpis.critical}
          accent="red"
        />
        <KpiCard
          label="Calibration Only (Zero Parts)"
          value={kpis.calibrationOnly}
          accent="purple"
        />
        <KpiCard label="Open Directives" value={kpis.openDirectives} />
      </div>

      {selectedSession && (
        <DirectivePreview
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TabValue)}
        className="gap-4"
      >
        <TabsList className="h-9 w-full max-w-2xl justify-start">
          <TabsTrigger className="px-3" value="coverage">
            Fleet Coverage &amp; Queue
            <Badge variant="secondary" title="Trucks scanned / total">
              {kpis.scanned}/{kpis.total}
            </Badge>
          </TabsTrigger>
          <TabsTrigger className="px-3" value="scan">
            New PTT Scan
          </TabsTrigger>
          <TabsTrigger className="px-3" value="intelligence">
            Fleet Fault Intelligence
            <Badge variant="secondary" title="Recurring faults">
              {recurringFaults.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* Kept mounted so search / filter state survives tab switches. */}
        <TabsContent value="coverage" keepMounted>
          <FleetCoverageView
            rosterFleetIds={rosterFleetIds}
            sessions={sessions}
            onViewDirective={openDirective}
            onScanTruck={startScan}
          />
        </TabsContent>

        <TabsContent value="scan">
          <NewPttScanPanel
            key={scanFleetId ?? "none"}
            initialFleetId={scanFleetId}
            onScanComplete={handleScanComplete}
          />
        </TabsContent>

        <TabsContent value="intelligence" keepMounted>
          <FleetFaultIntelligence
            recurringFaults={recurringFaults}
            onOpenFleet={openFleetDirective}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: "red" | "purple"
}) {
  return (
    <Card
      size="sm"
      className={cn(
        accent === "red" && "ring-red-500/40",
        accent === "purple" && "ring-purple-500/40"
      )}
    >
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn(
            "text-3xl tabular-nums",
            accent === "red" && "text-red-600 dark:text-red-400",
            accent === "purple" && "text-purple-600 dark:text-purple-400"
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <span className="text-xs text-muted-foreground">
          {value === 1 ? "truck" : "trucks"}
        </span>
      </CardContent>
    </Card>
  )
}

// Temporary preview shown for "View Directive" until the Executive Directive
// modal is wired in.
function DirectivePreview({
  session,
  onClose,
}: {
  session: PttSessionWithRelations
  onClose: () => void
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-mono text-base">
            {normalizeFleetId(session.fleetId)}
          </CardTitle>
          <SeverityBadge severity={session.overallSeverity} />
          <WorkflowStatusBadge status={session.status} />
          <span className="text-xs text-muted-foreground">
            Scanned {format(session.scannedAt, "dd MMM yyyy")}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label="Close directive preview"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <CardDescription>
          Directive preview — the full Executive Directive view is coming soon.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground uppercase">
          True diagnosis
        </p>
        <p className="text-sm leading-relaxed">
          {session.aiDirective?.true_diagnosis.trim() ||
            "No directive was generated for this scan."}
        </p>
      </CardContent>
    </Card>
  )
}
