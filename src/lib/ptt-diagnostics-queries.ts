import "server-only"

import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  ilike,
  inArray,
  min,
  ne,
  not,
} from "drizzle-orm"

import { db } from "@/db"
import {
  assetsTable,
  pttDiagnosticSessionsTable,
  pttScanFaultsTable,
} from "@/db/schema"
import { trailerIdentityFilter } from "@/lib/fleet-identity"
import { requireAdmin } from "@/lib/hr-admin-auth"
import { queryBaselineSessions } from "@/lib/ptt/session-query"
import {
  PTT_SEVERITY_RANK,
  compareFleetIds,
  latestSessionByFleet,
  normalizeFleetId,
  type PttFaultSeverity,
  type PttTruckGeneration,
} from "@/lib/ptt-diagnostics"

// Server-side reads for the Fleet Diagnostics (PTT Intel) dashboard. Called
// from the `/diagnostics` Server Component only; results are passed to Client
// Components as props.

// A baseline session with its fault codes, attachments and post-work
// verification scans, as returned by Drizzle. Verification scans are not
// listed on their own: the truck's baseline scan carries them.
export type PttSessionWithRelations = Awaited<
  ReturnType<typeof queryBaselineSessions>
>[number]

export type PttVerificationScanWithRelations =
  PttSessionWithRelations["verificationScans"][number]

export type PttScanFaultRow =
  PttVerificationScanWithRelations["scanFaults"][number]

export type PttLedgerRow = Awaited<ReturnType<typeof queryLedger>>[number]

export type PttApprovedExceptionRow = Awaited<
  ReturnType<typeof queryActiveExceptions>
>[number]

// Workshop accountability KPIs (all derived from SQL aggregates).
export type PttWorkshopKpis = {
  /** Verification scans on record (denominator of the regression rate). */
  verificationScanCount: number
  /** Actionable Critical / Calibration faults cleared on the first verification scan. */
  firstTimeFixRate: number | null
  firstTimeFixCleared: number
  firstTimeFixTotal: number
  /** Verification scans that introduced at least one NEW_REGRESSION fault. */
  collateralRegressionRate: number | null
  regressionScanCount: number
  /** Faults that reappeared within 30 days of being marked cleared. */
  bounceBackCount: number
  bounceBackRate: number | null
  /** Trucks whose latest case is open / blocked with a Critical or Calibration fault. */
  openBlockingTrucks: number
}

// One fault code (grouped by code + ECU) aggregated across every truck's
// latest open scan.
export type RecurringFault = {
  faultCode: string
  controlUnit: string
  componentDescription: string
  highestSeverity: PttFaultSeverity
  calibrationRequired: boolean
  /** Distinct, naturally sorted fleet numbers (`MTL01`, `MTL02`, ...). */
  affectedFleetIds: string[]
  affectedTruckCount: number
  /** Most recent scan date among the affected trucks' latest open scans. */
  latestScannedAt: Date
  /** AI root-cause summary from the most severe (then most recent) occurrence. */
  sampleIntervention: string
}

export type PttRosterTruck = {
  fleetId: string
  generation: PttTruckGeneration
}

export type PttDiagnosticsOverview = {
  kpis: PttWorkshopKpis
  /** Every truck's fault ledger rows. */
  ledger: PttLedgerRow[]
  /** Active approved exceptions (re-applied to baseline-only scans in exports). */
  exceptions: PttApprovedExceptionRow[]
  /** Active `MTL` truck roster (plus any scanned-but-unsynced trucks). */
  rosterFleetIds: string[]
  /**
   * `rosterFleetIds` with each truck's generation (from its newest scan that
   * identified one; `UNKNOWN` for a truck never scanned). Feeds the Fleet
   * Works Tracker export.
   */
  rosterTrucks: PttRosterTruck[]
  /** Every session, newest `scannedAt` first. */
  sessions: PttSessionWithRelations[]
  recurringFaults: RecurringFault[]
}

// Active motive-unit trucks: names starting with `MTL` (case-insensitive).
// `MT…` trailers never match the prefix, and trailer-typed assets and cranes
// are excluded explicitly (same motive/towed split as the Logistics module).
async function queryMtlTruckNames(): Promise<string[]> {
  const rows = await db
    .select({ assetName: assetsTable.assetName })
    .from(assetsTable)
    .where(
      and(
        ilike(assetsTable.assetName, "MTL%"),
        not(trailerIdentityFilter()),
        ne(assetsTable.assetType, "Crane")
      )
    )

  return rows.map((row) => row.assetName)
}

function normalizeFaultKeyPart(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase()
}

type FaultGroup = {
  faultCode: string
  controlUnit: string
  componentDescription: string
  highestRank: number
  highestSeverity: PttFaultSeverity
  calibrationRequired: boolean
  fleetIds: Set<string>
  latestScannedAt: Date
  sampleIntervention: string
  // Scan time of the occurrence behind `sampleIntervention`, so equally severe
  // occurrences resolve to the newer scan.
  sampleScannedAt: Date
}

// Aggregates faults from each truck's latest session only. Sessions already
// `VERIFIED_CLOSED` and faults flagged `resolvedOnRescan` are skipped, so the
// result reflects what is still outstanding across the fleet.
function buildRecurringFaults(
  sessions: readonly PttSessionWithRelations[]
): RecurringFault[] {
  const groups = new Map<string, FaultGroup>()

  for (const [fleetId, session] of latestSessionByFleet(sessions)) {
    if (session.status === "VERIFIED_CLOSED") continue

    for (const fault of session.faults) {
      if (fault.resolvedOnRescan) continue

      const faultCode = normalizeFaultKeyPart(fault.faultCode)
      const controlUnit = normalizeFaultKeyPart(fault.controlUnit)
      if (!faultCode) continue

      const key = `${faultCode}|${controlUnit}`
      const rank = PTT_SEVERITY_RANK[fault.severity]
      let group = groups.get(key)

      if (!group) {
        group = {
          faultCode,
          controlUnit,
          componentDescription: fault.componentDescription.trim(),
          highestRank: rank,
          highestSeverity: fault.severity,
          calibrationRequired: false,
          fleetIds: new Set(),
          latestScannedAt: session.scannedAt,
          sampleIntervention: fault.rootCauseSummary.trim(),
          sampleScannedAt: session.scannedAt,
        }
        groups.set(key, group)
      } else {
        const moreSevere = rank > group.highestRank
        if (moreSevere) {
          // Describe the group by its most severe occurrence.
          group.highestRank = rank
          group.highestSeverity = fault.severity
          group.componentDescription =
            fault.componentDescription.trim() || group.componentDescription
        }

        // Most severe occurrence wins; equally severe ones resolve to the
        // most recent scan.
        const intervention = fault.rootCauseSummary.trim()
        if (
          intervention &&
          (moreSevere ||
            (rank === group.highestRank &&
              session.scannedAt.getTime() > group.sampleScannedAt.getTime()) ||
            !group.sampleIntervention)
        ) {
          group.sampleIntervention = intervention
          group.sampleScannedAt = session.scannedAt
        }

        if (session.scannedAt.getTime() > group.latestScannedAt.getTime()) {
          group.latestScannedAt = session.scannedAt
        }
      }

      if (fault.calibrationRequired) group.calibrationRequired = true
      group.fleetIds.add(fleetId)
    }
  }

  return [...groups.values()]
    .map<RecurringFault>((group) => {
      const affectedFleetIds = [...group.fleetIds].sort(compareFleetIds)
      return {
        faultCode: group.faultCode,
        controlUnit: group.controlUnit,
        componentDescription: group.componentDescription,
        highestSeverity: group.highestSeverity,
        calibrationRequired: group.calibrationRequired,
        affectedFleetIds,
        affectedTruckCount: affectedFleetIds.length,
        latestScannedAt: group.latestScannedAt,
        sampleIntervention: group.sampleIntervention,
      }
    })
    .sort(
      (a, b) =>
        b.affectedTruckCount - a.affectedTruckCount ||
        PTT_SEVERITY_RANK[b.highestSeverity] -
          PTT_SEVERITY_RANK[a.highestSeverity] ||
        a.faultCode.localeCompare(b.faultCode)
    )
}

function queryLedger() {
  return db.query.pttTruckFaultLedgerTable.findMany({
    orderBy: { fleetId: "asc", lastSeenAt: "desc", id: "desc" },
  })
}

function queryActiveExceptions() {
  return db.query.pttApprovedExceptionsTable.findMany({
    where: { isActive: true },
  })
}

const percent = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10

const BLOCKING_SEVERITIES: PttFaultSeverity[] = ["CRITICAL", "CALIBRATION_ONLY"]

async function queryWorkshopKpis(): Promise<PttWorkshopKpis> {
  // Each case's FIRST verification scan (lowest id).
  const firstScans = await db
    .select({ id: min(pttDiagnosticSessionsTable.id) })
    .from(pttDiagnosticSessionsTable)
    .where(eq(pttDiagnosticSessionsTable.scanRole, "VERIFICATION"))
    .groupBy(pttDiagnosticSessionsTable.caseId)
  const firstScanIds = firstScans
    .map((row) => row.id)
    .filter((id): id is number => id !== null)

  const [
    verificationTotals,
    regressionTotals,
    firstFixRows,
    bounceTotals,
    clearedEventTotals,
    latestBaselines,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(pttDiagnosticSessionsTable)
      .where(eq(pttDiagnosticSessionsTable.scanRole, "VERIFICATION")),
    db
      .select({ value: countDistinct(pttScanFaultsTable.scanId) })
      .from(pttScanFaultsTable)
      .where(eq(pttScanFaultsTable.reconciliationBucket, "NEW_REGRESSION")),
    firstScanIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            bucket: pttScanFaultsTable.reconciliationBucket,
            value: count(),
          })
          .from(pttScanFaultsTable)
          .where(
            and(
              inArray(pttScanFaultsTable.scanId, firstScanIds),
              inArray(pttScanFaultsTable.severity, BLOCKING_SEVERITIES),
              eq(pttScanFaultsTable.isApprovedException, false),
              inArray(pttScanFaultsTable.reconciliationBucket, [
                "CLEARED",
                "PERSISTING_OPEN",
              ])
            )
          )
          .groupBy(pttScanFaultsTable.reconciliationBucket),
    db
      .select({ value: count() })
      .from(pttScanFaultsTable)
      .where(eq(pttScanFaultsTable.isBounceBack, true)),
    db
      .select({ value: count() })
      .from(pttScanFaultsTable)
      .where(
        and(
          eq(pttScanFaultsTable.reconciliationBucket, "CLEARED"),
          eq(pttScanFaultsTable.isApprovedException, false)
        )
      ),
    // Latest baseline scan per truck.
    db
      .selectDistinctOn([pttDiagnosticSessionsTable.fleetId], {
        caseStatus: pttDiagnosticSessionsTable.caseStatus,
        overallSeverity: pttDiagnosticSessionsTable.overallSeverity,
      })
      .from(pttDiagnosticSessionsTable)
      .where(eq(pttDiagnosticSessionsTable.scanRole, "BASELINE"))
      .orderBy(
        pttDiagnosticSessionsTable.fleetId,
        desc(pttDiagnosticSessionsTable.scannedAt),
        desc(pttDiagnosticSessionsTable.id)
      ),
  ])

  const verificationScanCount = verificationTotals[0]?.value ?? 0
  const regressionScanCount = regressionTotals[0]?.value ?? 0
  const firstTimeFixCleared =
    firstFixRows.find((row) => row.bucket === "CLEARED")?.value ?? 0
  const firstTimeFixPersisting =
    firstFixRows.find((row) => row.bucket === "PERSISTING_OPEN")?.value ?? 0
  const firstTimeFixTotal = firstTimeFixCleared + firstTimeFixPersisting
  const bounceBackCount = bounceTotals[0]?.value ?? 0
  const clearedEvents = clearedEventTotals[0]?.value ?? 0

  return {
    verificationScanCount,
    firstTimeFixRate: percent(firstTimeFixCleared, firstTimeFixTotal),
    firstTimeFixCleared,
    firstTimeFixTotal,
    collateralRegressionRate: percent(regressionScanCount, verificationScanCount),
    regressionScanCount,
    bounceBackCount,
    bounceBackRate: percent(Math.min(bounceBackCount, clearedEvents), clearedEvents),
    openBlockingTrucks: latestBaselines.filter(
      (truck) =>
        (truck.caseStatus === "OPEN" ||
          truck.caseStatus === "PARTIAL_BLOCKED" ||
          truck.caseStatus === "REJECTED_NO_PROGRESS") &&
        BLOCKING_SEVERITIES.includes(
          truck.overallSeverity as PttFaultSeverity
        )
    ).length,
  }
}

export async function getPttDiagnosticsOverview(): Promise<PttDiagnosticsOverview> {
  await requireAdmin()

  const [mtlTruckNames, sessions, kpis, ledger, exceptions] = await Promise.all(
    [
      queryMtlTruckNames(),
      queryBaselineSessions(),
      queryWorkshopKpis(),
      queryLedger(),
      queryActiveExceptions(),
    ]
  )

  // Union the synced roster with any truck already scanned (e.g. scanned
  // before `assets` was synced), deduplicated by canonical fleet id.
  const roster = new Set<string>()
  for (const name of mtlTruckNames) roster.add(normalizeFleetId(name))
  for (const session of sessions) roster.add(normalizeFleetId(session.fleetId))

  const rosterFleetIds = [...roster].filter(Boolean).sort(compareFleetIds)

  // Newest scan that actually identified a generation wins per truck.
  const generationByFleet = new Map<string, PttTruckGeneration>()
  const newestFirst = [...sessions].sort(
    (a, b) => b.scannedAt.getTime() - a.scannedAt.getTime() || b.id - a.id
  )
  for (const session of newestFirst) {
    const fleetId = normalizeFleetId(session.fleetId)
    if (session.truckGeneration !== "UNKNOWN" && !generationByFleet.has(fleetId)) {
      generationByFleet.set(fleetId, session.truckGeneration)
    }
  }

  return {
    kpis,
    ledger,
    exceptions,
    rosterFleetIds,
    rosterTrucks: rosterFleetIds.map((fleetId) => ({
      fleetId,
      generation: generationByFleet.get(fleetId) ?? "UNKNOWN",
    })),
    sessions,
    recurringFaults: buildRecurringFaults(sessions),
  }
}
