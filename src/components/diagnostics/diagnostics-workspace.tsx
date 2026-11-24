"use client"

import { useRouter } from "next/navigation"
import { useCallback, useMemo, useState } from "react"

import { FleetCoverageView } from "@/components/diagnostics/fleet-coverage-view"
import { FleetFaultIntelligence } from "@/components/diagnostics/fleet-fault-intelligence"
import { NewPttScanPanel } from "@/components/diagnostics/new-ptt-scan-panel"
import { PttDirectiveModal } from "@/components/diagnostics/ptt-directive-modal"
import { PttExportDialogButton } from "@/components/diagnostics/ptt-export-dialog-button"
import { PttVerificationSection } from "@/components/diagnostics/ptt-verification-section"
import { Badge } from "@/components/ui/badge"
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
  sessions: serverSessions,
  recurringFaults,
}: {
  rosterFleetIds: string[]
  sessions: PttSessionWithRelations[]
  recurringFaults: RecurringFault[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<TabValue>("coverage")
  const [scanFleetId, setScanFleetId] = useState<string | null>(null)
  // Bumped on every "Scan Truck" click so the panel re-applies the truck even
  // when the same one is clicked twice.
  const [scanToken, setScanToken] = useState(0)
  // The modal tracks a session id (not the row) so it always shows the latest
  // server data after `router.refresh()`.
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    null
  )
  // A just-created scan, shown until the refreshed `sessions` prop includes it.
  const [createdSession, setCreatedSession] =
    useState<PttSessionWithRelations | null>(null)

  // A just-verified session, shown until `router.refresh()` delivers a new
  // `sessions` array (tracked by `base` identity so it can never go stale).
  const [verifiedOverride, setVerifiedOverride] = useState<{
    session: PttSessionWithRelations
    base: PttSessionWithRelations[]
  } | null>(null)

  // Scans deleted in this browser session. Hidden immediately (before the
  // server re-read lands) so the KPIs, coverage list and intelligence inputs
  // update right away. Ids are never reused, so the set can safely linger.
  const [deletedSessionIds, setDeletedSessionIds] = useState<
    ReadonlySet<number>
  >(() => new Set())

  const effectiveSessions = useMemo(() => {
    const live =
      deletedSessionIds.size === 0
        ? serverSessions
        : serverSessions.filter((session) => !deletedSessionIds.has(session.id))
    if (!verifiedOverride || verifiedOverride.base !== serverSessions) {
      return live
    }
    return live.map((session) =>
      session.id === verifiedOverride.session.id
        ? verifiedOverride.session
        : session
    )
  }, [serverSessions, verifiedOverride, deletedSessionIds])

  const sessions = effectiveSessions

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

  const selectedSession = useMemo(() => {
    if (selectedSessionId === null) return null
    const fromList = sessions.find((session) => session.id === selectedSessionId)
    if (fromList) return fromList
    if (createdSession?.id !== selectedSessionId) return null
    return verifiedOverride?.session.id === createdSession.id
      ? verifiedOverride.session
      : createdSession
  }, [sessions, selectedSessionId, createdSession, verifiedOverride])

  // Every scan of the selected truck, newest first, for the history selector.
  const selectedFleetSessions = useMemo(() => {
    if (!selectedSession) return []
    const fleetId = normalizeFleetId(selectedSession.fleetId)
    const all =
      sessions.some((session) => session.id === selectedSession.id)
        ? sessions
        : [selectedSession, ...sessions]
    return all.filter((session) => normalizeFleetId(session.fleetId) === fleetId)
  }, [sessions, selectedSession])

  const openDirective = useCallback((session: PttSessionWithRelations) => {
    setSelectedSessionId(session.id)
  }, [])

  const openFleetDirective = useCallback(
    (fleetId: string) => {
      const latest = latestByFleet.get(normalizeFleetId(fleetId))
      if (latest) setSelectedSessionId(latest.id)
    },
    [latestByFleet]
  )

  const handleSessionVerified = useCallback(
    (session: PttSessionWithRelations) => {
      setVerifiedOverride({ session, base: serverSessions })
    },
    [serverSessions]
  )

  const closeDirective = useCallback(() => {
    setSelectedSessionId(null)
    setCreatedSession(null)
  }, [])

  // A scan was deleted from Fleet Coverage or the directive modal: drop every
  // local reference to it, close the modal if it was open, and re-run the
  // server reads so Sweep Progress, KPIs, coverage and Fleet Fault
  // Intelligence all refresh.
  const handleSessionDeleted = useCallback(
    (sessionId: number) => {
      setDeletedSessionIds((ids) => new Set(ids).add(sessionId))
      setCreatedSession((current) => (current?.id === sessionId ? null : current))
      setVerifiedOverride((current) =>
        current?.session.id === sessionId ? null : current
      )
      setSelectedSessionId((current) =>
        current === sessionId ? null : current
      )
      router.refresh()
    },
    [router]
  )

  const startScan = useCallback((fleetId: string | null) => {
    setScanFleetId(fleetId)
    setScanToken((token) => token + 1)
    setTab("scan")
  }, [])

  const handleScanComplete = useCallback(
    (session: PttSessionWithRelations) => {
      setScanFleetId(null)
      setCreatedSession(session)
      setSelectedSessionId(session.id)
      setTab("coverage")
      // Re-run the server reads so the new scan shows up in coverage / KPIs.
      router.refresh()
    },
    [router]
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Always accessible, whichever tab is open. */}
      <div className="flex justify-end">
        <PttExportDialogButton sessions={sessions} />
      </div>

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
            onSessionDeleted={handleSessionDeleted}
          />
        </TabsContent>

        {/* Kept mounted so selected photos survive tab switches. */}
        <TabsContent value="scan" keepMounted>
          <NewPttScanPanel
            initialFleetId={scanFleetId}
            syncToken={scanToken}
            rosterFleetIds={rosterFleetIds}
            onScanComplete={handleScanComplete}
          />
        </TabsContent>

        <TabsContent value="intelligence" keepMounted>
          <FleetFaultIntelligence
            recurringFaults={recurringFaults}
            sessions={sessions}
            onOpenFleet={openFleetDirective}
          />
        </TabsContent>
      </Tabs>

      <PttDirectiveModal
        session={selectedSession}
        fleetSessions={selectedFleetSessions}
        onSelectSession={setSelectedSessionId}
        onClose={closeDirective}
        onSessionDeleted={handleSessionDeleted}
        verificationSlot={
          selectedSession ? (
            <PttVerificationSection
              key={selectedSession.id}
              session={selectedSession}
              onSessionUpdate={handleSessionVerified}
            />
          ) : undefined
        }
      />
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
