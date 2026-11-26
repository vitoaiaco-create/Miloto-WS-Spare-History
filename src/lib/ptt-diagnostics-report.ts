import { format } from "date-fns"

import {
  PTT_FAULT_SEVERITIES,
  PTT_SEVERITY_RANK,
  compareFleetIds,
  latestSessionByFleet,
  normalizeFleetId,
  summarizePttFaults,
  type PttDirective,
  type PttFaultSeverity,
  type PttOverallSeverity,
} from "@/lib/ptt-diagnostics"

// Export filter options plus the baseline-scan row flattening behind the
// Fleet Fault Intelligence register. One pure, client-safe module (no
// `@/db/schema` import, no `server-only`).
//
// The PDF / Excel exports no longer live here: they are built from the
// reconciliation-aware `src/lib/ptt/report-data.ts` (one shared data layer for
// both PDFs and the workbook), which reuses the filter options below.

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

export const PTT_REPORT_SCOPES = [
  "LATEST_OPEN",
  "LATEST_ALL",
  "ALL_SCANS",
] as const
export type PttReportScope = (typeof PTT_REPORT_SCOPES)[number]

export const PTT_REPORT_SCOPE_LABELS: Record<PttReportScope, string> = {
  LATEST_OPEN: "Latest Open Scan per Truck",
  LATEST_ALL: "Latest Scan per Truck (Incl. Closed)",
  ALL_SCANS: "All Historical Scans",
}

export type PttReportFilterOptions = {
  /**
   * `LATEST_OPEN` (default): each truck's latest scan, unless it is already
   * `VERIFIED_CLOSED`, ignoring faults resolved on re-scan - the same set the
   * Fleet Fault Intelligence recurring groups are built from.
   * `LATEST_ALL`: each truck's latest scan, closed or not.
   * `ALL_SCANS`: every scan ever logged.
   */
  scope: PttReportScope
  /** Faults of these severities are kept (default: all four). */
  severities: PttFaultSeverity[]
  /** A specific normalized fleet number, or `'ALL'`. */
  fleetId: string | "ALL"
  /** `YYYY-MM-DD` (from <input type="date">), filtering on the scan date. */
  fromDate?: string
  toDate?: string
}

export const DEFAULT_PTT_REPORT_OPTIONS: PttReportFilterOptions = {
  scope: "LATEST_OPEN",
  severities: [...PTT_FAULT_SEVERITIES],
  fleetId: "ALL",
}

export const PTT_SEVERITY_FILTER_LABELS: Record<PttFaultSeverity, string> = {
  CRITICAL: "Critical",
  CALIBRATION_ONLY: "Calibration Only",
  MONITOR: "Monitor",
  NEGLIGIBLE: "Negligible",
}

// ---------------------------------------------------------------------------
// Input shape (structural, so a Drizzle row with `faults` fits as-is)
// ---------------------------------------------------------------------------

export type PttReportFault = {
  faultCode: string
  controlUnit: string
  componentDescription: string
  faultState: string
  occurrenceCount: number | null
  severity: PttFaultSeverity
  calibrationRequired: boolean
  rootCauseSummary: string
  resolvedOnRescan: boolean
}

export type PttReportSession = {
  id: number
  fleetId: string
  truckGeneration: string
  status: string
  scannedAt: Date
  aiDirective: PttDirective | null
  faults: readonly PttReportFault[]
}

// ---------------------------------------------------------------------------
// Output rows
// ---------------------------------------------------------------------------

export type PttFaultReportRow = {
  /** `YYYY-MM-DD`. */
  scanDate: string
  fleetId: string
  /** `FH V3` / `FH V4` / `Unknown`. */
  truckGeneration: string
  sessionStatus: string
  faultCode: string
  controlUnit: string
  faultState: "ACTIVE" | "INACTIVE" | "UNKNOWN"
  occurrenceCount: number | null
  pttDescription: string
  aiSeverity: PttFaultSeverity
  calibrationRequired: boolean
  /** The fault's `rootCauseSummary`. */
  faultIntervention: string
  /** Plain-text digest of the truck's directive (warning, checks, paths, criteria). */
  workshopDirectiveSummary: string
  sessionId: number
}

export type PttTruckSummaryRow = {
  scanDate: string
  fleetId: string
  truckGeneration: string
  sessionStatus: string
  /** Worst severity among the faults kept by the filter. */
  overallSeverity: PttOverallSeverity
  totalFaults: number
  criticalFaults: number
  calibrationFaults: number
  monitorFaults: number
  negligibleFaults: number
  trueDiagnosis: string
  partsCannonWarning: string
  /** Numbered, one check per line. */
  physicalInspections: string
  /** Bulleted, one path per line. */
  pttPaths: string
  /** Bulleted, one criterion per line. */
  verificationCriteria: string
  sessionId: number
}

export type PttReportRows = {
  faultRows: PttFaultReportRow[]
  /** One row per matching session (a session with at least one fault row). */
  truckSummaryRows: PttTruckSummaryRow[]
  /** Distinct trucks among `faultRows`. */
  truckCount: number
}

const SESSION_STATUS_LABELS: Record<string, string> = {
  SCANNED: "Scanned",
  DIRECTIVE_ISSUED: "Directive Issued",
  IN_PROGRESS: "In Progress",
  VERIFIED_CLOSED: "Verified Closed",
}

const GENERATION_REPORT_LABELS: Record<string, string> = {
  FH_V3: "FH V3",
  FH_V4: "FH V4",
}

function formatScanDate(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

// `YYYY-MM-DD` -> local-time day boundaries (same as the HR report).
function startOfDay(value?: string): number | null {
  return value ? new Date(`${value}T00:00:00`).getTime() : null
}

function endOfDay(value?: string): number | null {
  return value ? new Date(`${value}T23:59:59.999`).getTime() : null
}

function normalizeFaultState(state: string): "ACTIVE" | "INACTIVE" | "UNKNOWN" {
  return state === "ACTIVE" || state === "INACTIVE" ? state : "UNKNOWN"
}

function numbered(items: readonly string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, i) => `${i + 1}. ${item}`)
    .join("\n")
}

function bulleted(items: readonly string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `\u2022 ${item}`)
    .join("\n")
}

function inline(items: readonly string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .join("; ")
}

// "Parts Warning: ...\nPhysical Inspections: a; b\nPTT Paths: ...".
function buildDirectiveSummary(directive: PttDirective | null): string {
  if (!directive) return ""
  const sections: [string, string][] = [
    ["Parts Warning", directive.parts_cannon_warning.trim()],
    ["Physical Inspections", inline(directive.physical_inspections)],
    ["PTT Paths", inline(directive.ptt_navigation_paths)],
    ["Verification Criteria", inline(directive.verification_criteria)],
  ]
  return sections
    .filter(([, text]) => text)
    .map(([label, text]) => `${label}: ${text}`)
    .join("\n")
}

function resolveOptions(
  options: Partial<PttReportFilterOptions> | undefined
): PttReportFilterOptions {
  const fleetId = options?.fleetId?.trim()
  return {
    scope: options?.scope ?? DEFAULT_PTT_REPORT_OPTIONS.scope,
    severities: options?.severities ?? [...PTT_FAULT_SEVERITIES],
    fleetId: !fleetId || fleetId === "ALL" ? "ALL" : normalizeFleetId(fleetId),
    fromDate: options?.fromDate || undefined,
    toDate: options?.toDate || undefined,
  }
}

// ---------------------------------------------------------------------------
// Shared filter + row builder
// ---------------------------------------------------------------------------

/**
 * Single source of truth for which faults a scope / severity / truck / date
 * selection yields. The scope picks the scans first (latest per truck, or all);
 * the truck, date range and severity filters then narrow them, so "latest"
 * always means the truck's genuine latest scan.
 *
 * `faultRows` are sorted by scan time (newest first), natural fleet number,
 * then worst severity first.
 */
export function buildPttFaultReportRows(
  sessions: readonly PttReportSession[],
  options?: Partial<PttReportFilterOptions>
): PttReportRows {
  const { scope, severities, fleetId, fromDate, toDate } =
    resolveOptions(options)
  const severitySet = new Set<PttFaultSeverity>(severities)
  const fromMs = startOfDay(fromDate)
  const toMs = endOfDay(toDate)

  let scoped: PttReportSession[]
  if (scope === "ALL_SCANS") {
    scoped = [...sessions]
  } else {
    scoped = [...latestSessionByFleet(sessions).values()]
    if (scope === "LATEST_OPEN") {
      scoped = scoped.filter((session) => session.status !== "VERIFIED_CLOSED")
    }
  }

  const matched = scoped.filter((session) => {
    if (fleetId !== "ALL" && normalizeFleetId(session.fleetId) !== fleetId) {
      return false
    }
    const scannedMs = session.scannedAt.getTime()
    if (fromMs !== null && scannedMs < fromMs) return false
    if (toMs !== null && scannedMs > toMs) return false
    return true
  })

  type Entry = { session: PttReportSession; fault: PttReportFault }
  const entries: Entry[] = []
  for (const session of matched) {
    for (const fault of session.faults) {
      if (!severitySet.has(fault.severity)) continue
      // Outstanding-only: faults already cleared by a re-scan are not open work.
      if (scope === "LATEST_OPEN" && fault.resolvedOnRescan) continue
      entries.push({ session, fault })
    }
  }

  entries.sort(
    (a, b) =>
      b.session.scannedAt.getTime() - a.session.scannedAt.getTime() ||
      compareFleetIds(a.session.fleetId, b.session.fleetId) ||
      b.session.id - a.session.id ||
      PTT_SEVERITY_RANK[b.fault.severity] - PTT_SEVERITY_RANK[a.fault.severity]
  )

  const faultRows: PttFaultReportRow[] = []
  const truckSummaryRows: PttTruckSummaryRow[] = []
  const directiveSummaries = new Map<number, string>()
  const faultsBySession = new Map<number, PttReportFault[]>()

  for (const { session, fault } of entries) {
    let directiveSummary = directiveSummaries.get(session.id)
    if (directiveSummary === undefined) {
      directiveSummary = buildDirectiveSummary(session.aiDirective)
      directiveSummaries.set(session.id, directiveSummary)
    }

    const sessionFaults = faultsBySession.get(session.id)
    if (sessionFaults) {
      sessionFaults.push(fault)
    } else {
      faultsBySession.set(session.id, [fault])
    }

    faultRows.push({
      scanDate: formatScanDate(session.scannedAt),
      fleetId: normalizeFleetId(session.fleetId),
      truckGeneration:
        GENERATION_REPORT_LABELS[session.truckGeneration] ?? "Unknown",
      sessionStatus: SESSION_STATUS_LABELS[session.status] ?? session.status,
      faultCode: fault.faultCode,
      controlUnit: fault.controlUnit,
      faultState: normalizeFaultState(fault.faultState),
      occurrenceCount: fault.occurrenceCount,
      pttDescription: fault.componentDescription,
      aiSeverity: fault.severity,
      calibrationRequired: fault.calibrationRequired,
      faultIntervention: fault.rootCauseSummary,
      workshopDirectiveSummary: directiveSummary,
      sessionId: session.id,
    })
  }

  // Sessions in order of first appearance (= the same sort as the faults).
  const seenSessions = new Set<number>()
  for (const { session } of entries) {
    if (seenSessions.has(session.id)) continue
    seenSessions.add(session.id)

    const summary = summarizePttFaults(faultsBySession.get(session.id) ?? [])
    const directive = session.aiDirective
    truckSummaryRows.push({
      scanDate: formatScanDate(session.scannedAt),
      fleetId: normalizeFleetId(session.fleetId),
      truckGeneration:
        GENERATION_REPORT_LABELS[session.truckGeneration] ?? "Unknown",
      sessionStatus: SESSION_STATUS_LABELS[session.status] ?? session.status,
      overallSeverity: summary.overallSeverity,
      totalFaults: faultsBySession.get(session.id)?.length ?? 0,
      criticalFaults: summary.criticalCount,
      calibrationFaults: summary.calibrationCount,
      monitorFaults: summary.monitorCount,
      negligibleFaults: summary.negligibleCount,
      trueDiagnosis: directive?.true_diagnosis.trim() ?? "",
      partsCannonWarning: directive?.parts_cannon_warning.trim() ?? "",
      physicalInspections: numbered(directive?.physical_inspections ?? []),
      pttPaths: bulleted(directive?.ptt_navigation_paths ?? []),
      verificationCriteria: bulleted(directive?.verification_criteria ?? []),
      sessionId: session.id,
    })
  }

  return {
    faultRows,
    truckSummaryRows,
    truckCount: new Set(faultRows.map((row) => row.fleetId)).size,
  }
}
