import "server-only"

import { and, ilike, ne, not } from "drizzle-orm"

import { db } from "@/db"
import { assetsTable } from "@/db/schema"
import { trailerIdentityFilter } from "@/lib/fleet-identity"
import { requireAdmin } from "@/lib/hr-admin-auth"
import {
  PTT_SEVERITY_RANK,
  compareFleetIds,
  latestSessionByFleet,
  normalizeFleetId,
  type PttFaultSeverity,
} from "@/lib/ptt-diagnostics"

// Server-side reads for the Fleet Diagnostics (PTT Intel) dashboard. Called
// from the `/diagnostics` Server Component only; results are passed to Client
// Components as props.

function querySessions() {
  return db.query.pttDiagnosticSessionsTable.findMany({
    // `id` breaks ties so ordering is stable for same-instant scans.
    orderBy: { scannedAt: "desc", id: "desc" },
    with: { faults: true, attachments: true },
  })
}

// A session with its fault codes and attachments, as returned by Drizzle.
export type PttSessionWithRelations = Awaited<
  ReturnType<typeof querySessions>
>[number]

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

export type PttDiagnosticsOverview = {
  /** Active `MTL` truck roster (plus any scanned-but-unsynced trucks). */
  rosterFleetIds: string[]
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

export async function getPttDiagnosticsOverview(): Promise<PttDiagnosticsOverview> {
  await requireAdmin()

  const [mtlTruckNames, sessions] = await Promise.all([
    queryMtlTruckNames(),
    querySessions(),
  ])

  // Union the synced roster with any truck already scanned (e.g. scanned
  // before `assets` was synced), deduplicated by canonical fleet id.
  const roster = new Set<string>()
  for (const name of mtlTruckNames) roster.add(normalizeFleetId(name))
  for (const session of sessions) roster.add(normalizeFleetId(session.fleetId))

  return {
    rosterFleetIds: [...roster].filter(Boolean).sort(compareFleetIds),
    sessions,
    recurringFaults: buildRecurringFaults(sessions),
  }
}
