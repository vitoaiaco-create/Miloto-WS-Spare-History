import { format } from "date-fns"

import {
  PTT_FAULT_SEVERITIES,
  PTT_SEVERITY_RANK,
  compareFleetIds,
  latestSessionByFleet,
  normalizeFleetId,
  type PttDirective,
  type PttFaultSeverity,
  type PttFaultState,
  type PttOverallSeverity,
  type PttTruckGeneration,
} from "../ptt-diagnostics"
import {
  PTT_REPORT_SCOPE_LABELS,
  PTT_SEVERITY_FILTER_LABELS,
  type PttReportFilterOptions,
  type PttReportScope,
} from "../ptt-diagnostics-report"
import { validateCanonicalKey } from "./canonical-key"
import {
  PTT_CLOSURE_REASON_LABELS,
  PTT_EXCEPTION_REASON_LABELS,
  isClosedCaseStatus,
  type PttCaseStatus,
  type PttClosureReasonCategory,
  type PttLedgerStatus,
  type PttReconciliationBucket,
  type PttScanFaultStatus,
} from "./constants"
import type { ApprovedExceptionRule } from "./reconcile"
import {
  buildScanKeyContext,
  canonicalKeyFor,
  toScanFaultStatus,
} from "./scan-faults"
import { classifyFaultSeverity, resolveSeverity } from "./severity-and-patterns"
import type { PttVerificationAudit } from "./verification-audit-schema"

// Single, deterministic report-data layer shared by BOTH Fleet Diagnostics
// PDFs and the 3-tab Excel workbook. Pure and client-safe (no I/O, no DB, no
// `server-only`): it receives rows the `/diagnostics` Server Component already
// read (baseline cases with their verification scans, the truck fault ledger
// and the active approved exceptions) and assembles every number, list and
// status the exports print. Because the PDFs and the workbook render the same
// `PttReportData`, their counts, cleared / outstanding lists, reconciliation
// statuses and KPIs can never disagree.

// ---------------------------------------------------------------------------
// Input shape (structural, so Drizzle rows fit as-is)
// ---------------------------------------------------------------------------

/** A stored `ptt_scan_faults` row (verification scans carry the buckets). */
export type PttReportScanFault = {
  canonicalKey: string
  ecuLabel: string
  dtcRaw: string
  description: string
  pttStatus: PttScanFaultStatus
  severity: PttFaultSeverity
  reconciliationBucket: PttReconciliationBucket | null
  isBounceBack: boolean
  isApprovedException: boolean
}

/** A legacy `ptt_fault_codes` row of the baseline scan. */
export type PttReportBaselineFault = {
  faultCode: string
  controlUnit: string
  componentDescription: string
  faultState: PttFaultState
  occurrenceCount: number | null
  severity: PttFaultSeverity
  rootCauseSummary: string
  calibrationRequired: boolean
  resolvedOnRescan: boolean
}

export type PttReportVerificationScan = {
  id: number
  scannedAt: Date
  caseStatus: PttCaseStatus
  verificationAudit: PttVerificationAudit | null
  scanFaults: readonly PttReportScanFault[]
}

/** A baseline scan = one case, with its post-work verification scans. */
export type PttReportCase = {
  id: number
  fleetId: string
  truckGeneration: PttTruckGeneration
  status: string
  caseStatus: PttCaseStatus
  scannedAt: Date
  verifiedAt: Date | null
  /** Controlled closure audit (CLOSED_ACCEPTED_RESIDUALS); absent on older rows. */
  closureReasonCategory?: PttClosureReasonCategory | null
  closureNote?: string | null
  closedAt?: Date | null
  /** Set by the legacy AI re-scan flow (before reconciliation existed). */
  verificationSummary: unknown
  aiDirective: PttDirective | null
  faults: readonly PttReportBaselineFault[]
  verificationScans: readonly PttReportVerificationScan[]
}

/** A `ptt_truck_fault_ledger` row. */
export type PttReportLedgerRow = {
  fleetId: string
  canonicalKey: string
  ecuLabel: string
  description: string
  latestSeverity: PttFaultSeverity
  ledgerStatus: PttLedgerStatus
  firstSeenAt: Date
  lastSeenAt: Date
  clearedAt: Date | null
  reopenCount: number
  lastReopenedAt: Date | null
}

/** A `ptt_approved_exceptions` row (only the fields the report needs). */
export type PttReportExceptionRule = ApprovedExceptionRule & {
  reasonCategory?: string | null
}

export type PttReportInput = {
  sessions: readonly PttReportCase[]
  ledger: readonly PttReportLedgerRow[]
  exceptions: readonly PttReportExceptionRule[]
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type PttReportDataOptions = Partial<PttReportFilterOptions> & {
  /** Drop approved-exception rows from the fault tables (default `true`). */
  excludeApprovedExceptions?: boolean
  /** Optional case-status filter (omit / empty = every status). */
  caseStatuses?: readonly PttCaseStatus[]
}

export type ResolvedPttReportOptions = PttReportFilterOptions & {
  excludeApprovedExceptions: boolean
  caseStatuses: readonly PttCaseStatus[]
}

export function resolvePttReportOptions(
  options?: PttReportDataOptions
): ResolvedPttReportOptions {
  const fleetId = options?.fleetId?.trim()
  return {
    scope: options?.scope ?? "LATEST_OPEN",
    severities: options?.severities ?? [...PTT_FAULT_SEVERITIES],
    fleetId: !fleetId || fleetId === "ALL" ? "ALL" : normalizeFleetId(fleetId),
    fromDate: options?.fromDate || undefined,
    toDate: options?.toDate || undefined,
    excludeApprovedExceptions: options?.excludeApprovedExceptions ?? true,
    caseStatuses: options?.caseStatuses ?? [],
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type PttReportFaultStatus =
  | "CLEARED"
  | "STILL_OPEN"
  | "NEW_REGRESSION"
  | "APPROVED_EXCEPTION"
  | "INACTIVE"

export const PTT_REPORT_FAULT_STATUS_LABELS: Record<PttReportFaultStatus, string> =
  {
    CLEARED: "Cleared",
    STILL_OPEN: "Still Open",
    NEW_REGRESSION: "New Regression",
    APPROVED_EXCEPTION: "Approved Exception",
    INACTIVE: "Inactive",
  }

export const PTT_SEVERITY_DISPLAY: Record<PttOverallSeverity, string> = {
  ...PTT_SEVERITY_FILTER_LABELS,
  CLEAR: "Clear",
}

export type PttReportCaseStatusLabel =
  | "VERIFIED CLOSED"
  | "CLOSED (ACCEPTED RESIDUALS)"
  | "PARTIAL / BLOCKED"
  | "NO PROGRESS"
  | "OPEN"

const CASE_STATUS_REPORT_LABELS: Record<PttCaseStatus, PttReportCaseStatusLabel> =
  {
    VERIFIED_CLOSED: "VERIFIED CLOSED",
    CLOSED_ACCEPTED_RESIDUALS: "CLOSED (ACCEPTED RESIDUALS)",
    PARTIAL_BLOCKED: "PARTIAL / BLOCKED",
    REJECTED_INCOMPLETE: "PARTIAL / BLOCKED",
    REJECTED_NO_PROGRESS: "NO PROGRESS",
    OPEN: "OPEN",
  }

const GENERATION_LABELS: Record<string, string> = {
  FH_V3: "FH V3",
  FH_V4: "FH V4",
}

export const AWAITING_VERIFICATION_TEXT = "Awaiting verification scan"
export const NONE_CLEARED_TEXT = "None cleared yet"
export const ALL_CLEARED_TEXT = "None \u2014 All actionable faults cleared"
const NO_ACTIONABLE_TEXT = "None \u2014 no actionable faults"

/** One fault of one case, fully classified. */
export type PttReportFaultItem = {
  canonicalKey: string
  /** `MID128 PID94 FMI5` (FH V3) / `EMS P255800` (FH V4). */
  codeLabel: string
  ecuLabel: string
  /** The code as printed by PTT. */
  dtcRaw: string
  description: string
  /** Trimmed single-line description used in `Code \u2014 Short Description`. */
  shortDescription: string
  faultState: "ACTIVE" | "INACTIVE"
  occurrenceCount: number | null
  severity: PttFaultSeverity
  calibrationRequired: boolean
  status: PttReportFaultStatus
  isBounceBack: boolean
  /** Times the truck ledger has reopened this fault. */
  reopenCount: number
  /** `N` of `[REPEAT xN]`; 0 when the fault is not a repeat. */
  repeatCount: number
  /** Concise per-fault action (never the whole truck directive). */
  intervention: string
}

export type PttReportTruck = {
  sessionId: number
  fleetId: string
  /** `FH V3` / `FH V4` / `Unknown`. */
  generation: string
  /** `YYYY-MM-DD` of the baseline scan. */
  baselineDate: string
  /** `YYYY-MM-DD` of the latest scan (verification when there is one). */
  scanDate: string
  /** `YYYY-MM-DD` of the latest verification; blank until verified. */
  lastVerifiedDate: string
  isVerified: boolean
  caseStatus: PttCaseStatus
  caseStatusLabel: PttReportCaseStatusLabel
  /** Closure audit (CLOSED_ACCEPTED_RESIDUALS only; blank otherwise). */
  closureReasonLabel: string
  closureNote: string
  /** `YYYY-MM-DD` the job was closed with accepted residuals. */
  closedDate: string
  /** Worst severity among the outstanding actionable faults (`CLEAR` if none). */
  overallSeverity: PttOverallSeverity

  clearedCount: number
  outstandingCount: number
  newRegressionsCount: number
  approvedExceptionsCount: number
  /** Outstanding actionable faults per tier (feeds the KPI strip). */
  outstandingBySeverity: Record<PttFaultSeverity, number>

  clearedItems: PttReportFaultItem[]
  outstandingItems: PttReportFaultItem[]
  /** `Code \u2014 Short Name` lines, or one placeholder line. */
  clearedFaultCodes: string[]
  /** `[NEW REGRESSION]` first, `[REPEAT xN]` tagged; never exceptions. */
  outstandingFaultCodes: string[]
  /** `+N approved exceptions excluded`, or null when there are none. */
  approvedExceptionsNote: string | null

  /** Every classified fault of the case after the severity filter. */
  faults: PttReportFaultItem[]

  /** `verdictHeadline` of the forensic audit; blank when baseline-only. */
  verdictHeadline: string
  collateralDamageAnalysis: string
  nextFloorActions: string[]

  trueDiagnosis: string
  partsWarning: string
  physicalChecks: string[]
  pttPaths: string[]
  verificationCriteria: string[]
}

/** A row of the Fault Register / PDF 1 table. */
export type PttReportFaultRow = PttReportFaultItem & {
  scanDate: string
  fleetId: string
  generation: string
  sessionId: number
}

export type PttReportLedgerItem = {
  fleetId: string
  generation: string
  canonicalKey: string
  ecuLabel: string
  description: string
  latestSeverity: PttFaultSeverity
  ledgerStatus: PttLedgerStatus
  /** `YYYY-MM-DD`. */
  firstSeenDate: string
  lastSeenDate: string
  /** Blank when not cleared. */
  clearedDate: string
  daysOpen: number
  reopenCount: number
  /** Blank when never reopened. */
  lastReopenedDate: string
}

export type PttReportKpis = {
  trucksCount: number
  openOrBlockedCount: number
  verifiedClosedCount: number
  /** Outstanding actionable CRITICAL faults. */
  actionableCriticalCount: number
  /** Outstanding actionable CALIBRATION_ONLY faults. */
  calibrationOnlyCount: number
  verifiedClearedCount: number
  outstandingActionableCount: number
  newRegressionsCount: number
  approvedExceptionsCount: number
  /** Blocking faults cleared on the first re-scan, or null with no re-scans. */
  firstTimeFixRatePct: number | null
}

export type PttReportData = {
  options: ResolvedPttReportOptions
  generatedAt: Date
  trucks: PttReportTruck[]
  /** Fault Register rows (approved exceptions removed when excluded). */
  faultRows: PttReportFaultRow[]
  /** Approved-exception rows left out of `faultRows` by the exclusion toggle. */
  excludedExceptionRows: number
  ledgerRows: PttReportLedgerItem[]
  kpis: PttReportKpis
}

// ---------------------------------------------------------------------------
// Formatting helpers (shared by every export)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

const formatDate = (date: Date): string => format(date, "yyyy-MM-dd")

/** Whole days between two instants (floored, never negative). */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS))
}

/** `MID128|PID94|FMI5` -> `MID128 PID94 FMI5`; unreadable keys use the printed code. */
export function formatCodeLabel(
  canonicalKey: string,
  ecuLabel: string,
  dtcRaw: string
): string {
  if (canonicalKey.startsWith("UNVERIFIED|")) {
    return `${ecuLabel} ${dtcRaw}`.replace(/\s+/g, " ").trim() || canonicalKey
  }
  return canonicalKey.split("|").join(" ")
}

const SHORT_DESCRIPTION_MAX = 72

/** Single-line description, cut at a word boundary when very long. */
export function shortenDescription(
  description: string,
  fallback: string
): string {
  const text = description.replace(/\s+/g, " ").trim()
  if (text === "") return fallback.trim() || "Description not captured"
  if (text.length <= SHORT_DESCRIPTION_MAX) return text
  const cut = text.slice(0, SHORT_DESCRIPTION_MAX - 1)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}\u2026`
}

/** `Code \u2014 Short Description` (never a bare code). */
export function formatFaultLine(item: PttReportFaultItem): string {
  return `${item.codeLabel} \u2014 ${item.shortDescription}`
}

/** `[NEW REGRESSION] [REPEAT x2] Code \u2014 Short Description`. */
export function formatOutstandingLine(item: PttReportFaultItem): string {
  const tags: string[] = []
  if (item.status === "NEW_REGRESSION") tags.push("[NEW REGRESSION]")
  if (item.repeatCount >= 1) tags.push(`[REPEAT x${item.repeatCount}]`)
  return [...tags, formatFaultLine(item)].join(" ")
}

/** `Still Open`, `Repeat x2`, ... the label of the PDF status pill. */
export function formatStatusPill(item: PttReportFaultItem): string {
  if (item.status === "NEW_REGRESSION") {
    return item.repeatCount >= 1
      ? `New Regression\nRepeat x${item.repeatCount}`
      : "New Regression"
  }
  if (item.status === "STILL_OPEN" && item.repeatCount >= 1) {
    return `Repeat x${item.repeatCount}`
  }
  return PTT_REPORT_FAULT_STATUS_LABELS[item.status]
}

export const PTT_REPORT_SCOPE_FILE_PARTS: Record<PttReportScope, string> = {
  LATEST_OPEN: "Latest_Open",
  LATEST_ALL: "Latest_All",
  ALL_SCANS: "All_Scans",
}

export type PttReportKind = "FAULT_PDF" | "EXECUTIVE_PDF" | "EXCEL"

const FILE_PREFIX: Record<PttReportKind, string> = {
  FAULT_PDF: "Miloto_PTT_Fault_Report",
  EXECUTIVE_PDF: "Miloto_PTT_Executive_Directives",
  EXCEL: "Miloto_PTT_Diagnostics",
}

/** `Miloto_PTT_<Kind>_<Scope>_<YYYY-MM-DD>.<ext>`. */
export function pttReportFileName(
  kind: PttReportKind,
  scope: PttReportScope,
  generatedAt: Date
): string {
  const extension = kind === "EXCEL" ? "xlsx" : "pdf"
  return `${FILE_PREFIX[kind]}_${PTT_REPORT_SCOPE_FILE_PARTS[scope]}_${format(generatedAt, "yyyy-MM-dd")}.${extension}`
}

function formatRange(fromDate?: string, toDate?: string): string | null {
  const fmt = (value: string) =>
    format(new Date(`${value}T00:00:00`), "dd MMM yyyy")
  if (fromDate && toDate) return `${fmt(fromDate)} to ${fmt(toDate)}`
  if (fromDate) return `From ${fmt(fromDate)}`
  if (toDate) return `Up to ${fmt(toDate)}`
  return null
}

/** Human-readable active-filter lines for the PDF subtitles. */
export function describePttReportFilters(
  options: ResolvedPttReportOptions
): string[] {
  const lines = [`Scope: ${PTT_REPORT_SCOPE_LABELS[options.scope]}`]

  const allSeverities = PTT_FAULT_SEVERITIES.every((s) =>
    options.severities.includes(s)
  )
  const filters = [
    `Severity: ${
      allSeverities
        ? "All"
        : PTT_FAULT_SEVERITIES.filter((s) => options.severities.includes(s))
            .map((s) => PTT_SEVERITY_FILTER_LABELS[s])
            .join(", ") || "None"
    }`,
    `Truck: ${options.fleetId === "ALL" ? "All trucks" : options.fleetId}`,
  ]
  const range = formatRange(options.fromDate, options.toDate)
  if (range) filters.push(`Scan date: ${range}`)
  filters.push(
    `Approved exceptions: ${options.excludeApprovedExceptions ? "excluded" : "included"}`
  )
  lines.push(filters.join("  |  "))
  return lines
}

// ---------------------------------------------------------------------------
// Case classification
// ---------------------------------------------------------------------------

const reasonLabels: Readonly<Record<string, string>> =
  PTT_EXCEPTION_REASON_LABELS

function findExceptionRule(
  rules: readonly PttReportExceptionRule[],
  fleetId: string,
  generation: PttTruckGeneration,
  canonicalKey: string
): PttReportExceptionRule | undefined {
  const fleet = normalizeFleetId(fleetId)
  return rules.find(
    (rule) =>
      rule.isActive &&
      rule.canonicalKey === canonicalKey &&
      ((rule.scope === "FLEET_GENERATION" && rule.generation === generation) ||
        (rule.scope === "TRUCK_SPECIFIC" &&
          rule.fleetId !== null &&
          normalizeFleetId(rule.fleetId) === fleet))
  )
}

export function newestVerificationFirst(
  scans: readonly PttReportVerificationScan[]
): PttReportVerificationScan[] {
  return [...scans].sort(
    (a, b) => b.scannedAt.getTime() - a.scannedAt.getTime() || b.id - a.id
  )
}

/** The case status the exports show (latest re-scan wins). */
export function effectiveCaseStatus(session: PttReportCase): PttCaseStatus {
  // A manager release outranks the re-scan's own verdict.
  if (session.caseStatus === "CLOSED_ACCEPTED_RESIDUALS") {
    return "CLOSED_ACCEPTED_RESIDUALS"
  }
  const latest = newestVerificationFirst(session.verificationScans)[0]
  if (latest) return latest.caseStatus
  // Closed by the legacy AI re-scan flow.
  if (session.status === "VERIFIED_CLOSED") return "VERIFIED_CLOSED"
  return session.caseStatus
}

export function latestScanAt(session: PttReportCase): Date {
  return (
    newestVerificationFirst(session.verificationScans)[0]?.scannedAt ??
    session.scannedAt
  )
}

const compareItems = (a: PttReportFaultItem, b: PttReportFaultItem): number =>
  PTT_SEVERITY_RANK[b.severity] - PTT_SEVERITY_RANK[a.severity] ||
  a.ecuLabel.localeCompare(b.ecuLabel) ||
  a.canonicalKey.localeCompare(b.canonicalKey)

const STATUS_PRIORITY: Record<PttReportFaultStatus, number> = {
  NEW_REGRESSION: 0,
  STILL_OPEN: 1,
  CLEARED: 2,
  APPROVED_EXCEPTION: 3,
  INACTIVE: 4,
}

const compareRows = (a: PttReportFaultItem, b: PttReportFaultItem): number =>
  STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status] || compareItems(a, b)

function interventionFor(
  status: PttReportFaultStatus,
  baselineRootCause: string,
  exceptionReason: string | null,
  isVerified: boolean
): string {
  switch (status) {
    case "APPROVED_EXCEPTION":
      return `Approved exception${exceptionReason ? ` (${exceptionReason})` : ""} \u2014 no action required.`
    case "INACTIVE":
      return "Inactive (historical) \u2014 no action required."
    case "CLEARED":
      return "Cleared on the verification scan \u2014 no further action."
    case "NEW_REGRESSION":
      return "Appeared after the repair. Inspect the connector, loom and component disturbed during the repair on this circuit before ordering any part."
    case "STILL_OPEN": {
      const rootCause = baselineRootCause.trim()
      if (rootCause) return rootCause
      return isVerified
        ? "Still active after the repair \u2014 diagnose with the truck directive before any part is ordered."
        : "Diagnose with the truck directive before any part is ordered."
    }
  }
}

type CaseFaults = {
  items: PttReportFaultItem[]
  /** Blocking-fault outcome of the FIRST re-scan (for the first-time-fix KPI). */
  firstFix: { cleared: number; total: number }
}

function bucketToStatus(fault: PttReportScanFault): PttReportFaultStatus {
  switch (fault.reconciliationBucket) {
    case "CLEARED":
      // A cleared approved exception is not workshop progress: it just reads
      // as no longer active.
      return fault.isApprovedException ? "INACTIVE" : "CLEARED"
    case "NEW_REGRESSION":
      return "NEW_REGRESSION"
    case "PERSISTING_OPEN":
      return "STILL_OPEN"
    case "PERSISTING_EXCEPTION":
    case "NEW_EXCEPTION":
      return "APPROVED_EXCEPTION"
    case null:
      if (fault.pttStatus === "INACTIVE") return "INACTIVE"
      return fault.isApprovedException ? "APPROVED_EXCEPTION" : "STILL_OPEN"
  }
}

function classifyCaseFaults(
  session: PttReportCase,
  input: PttReportInput,
  ledgerByKey: ReadonlyMap<string, PttReportLedgerRow>,
  severitySet: ReadonlySet<PttFaultSeverity>,
  isVerified: boolean
): CaseFaults {
  const fleetId = normalizeFleetId(session.fleetId)
  const generation = session.truckGeneration

  // Baseline rows by canonical key (ACTIVE beats INACTIVE, worse tier wins).
  const baselineByKey = new Map<string, PttReportBaselineFault>()
  const baselineContext = buildScanKeyContext(
    session.faults.map((fault) => ({
      controlUnit: fault.controlUnit,
      faultCode: fault.faultCode,
      description: fault.componentDescription,
    })),
    generation
  )
  for (const fault of session.faults) {
    const key = canonicalKeyFor(
      fault.controlUnit,
      fault.faultCode,
      generation,
      fault.componentDescription,
      baselineContext
    )
    const existing = baselineByKey.get(key)
    if (!existing) {
      baselineByKey.set(key, fault)
      continue
    }
    const existingActive = toScanFaultStatus(existing.faultState) === "ACTIVE"
    const faultActive = toScanFaultStatus(fault.faultState) === "ACTIVE"
    if (
      (faultActive && !existingActive) ||
      (faultActive === existingActive &&
        PTT_SEVERITY_RANK[fault.severity] > PTT_SEVERITY_RANK[existing.severity])
    ) {
      baselineByKey.set(key, fault)
    }
  }

  const reopenCountOf = (key: string) =>
    ledgerByKey.get(`${fleetId}|${key}`)?.reopenCount ?? 0

  const makeItem = (fields: {
    canonicalKey: string
    ecuLabel: string
    dtcRaw: string
    description: string
    pttStatus: PttScanFaultStatus
    severity: PttFaultSeverity
    status: PttReportFaultStatus
    isBounceBack: boolean
    baseline: PttReportBaselineFault | undefined
  }): PttReportFaultItem => {
    const reopenCount = reopenCountOf(fields.canonicalKey)
    const isRepeat = fields.isBounceBack || reopenCount >= 1
    const rule =
      fields.status === "APPROVED_EXCEPTION"
        ? findExceptionRule(
            input.exceptions,
            fleetId,
            generation,
            fields.canonicalKey
          )
        : undefined
    const description =
      fields.description.trim() ||
      fields.baseline?.componentDescription.trim() ||
      ""
    return {
      canonicalKey: fields.canonicalKey,
      codeLabel: formatCodeLabel(
        fields.canonicalKey,
        fields.ecuLabel,
        fields.dtcRaw
      ),
      ecuLabel: fields.ecuLabel,
      dtcRaw: fields.dtcRaw,
      description,
      shortDescription: shortenDescription(description, fields.ecuLabel),
      faultState: fields.pttStatus,
      occurrenceCount: fields.baseline?.occurrenceCount ?? null,
      severity: fields.severity,
      calibrationRequired:
        fields.baseline?.calibrationRequired ??
        fields.severity === "CALIBRATION_ONLY",
      status: fields.status,
      isBounceBack: fields.isBounceBack,
      reopenCount,
      repeatCount: isRepeat ? Math.max(1, reopenCount) : 0,
      intervention: interventionFor(
        fields.status,
        fields.baseline?.rootCauseSummary ?? "",
        rule?.reasonCategory ? (reasonLabels[rule.reasonCategory] ?? null) : null,
        isVerified
      ),
    }
  }

  const verificationScans = newestVerificationFirst(session.verificationScans)
  const latest = verificationScans[0]

  // --- Verified case: the stored reconciliation of the latest re-scan --------
  if (latest && latest.scanFaults.length > 0) {
    const items = latest.scanFaults.map((fault) =>
      makeItem({
        canonicalKey: fault.canonicalKey,
        ecuLabel: fault.ecuLabel,
        dtcRaw: fault.dtcRaw,
        description: fault.description,
        pttStatus: fault.pttStatus,
        severity: fault.severity,
        status: bucketToStatus(fault),
        isBounceBack: fault.isBounceBack,
        baseline: baselineByKey.get(fault.canonicalKey),
      })
    )

    // First-time-fix: blocking faults the FIRST re-scan cleared vs left open.
    const first = verificationScans[verificationScans.length - 1]
    let cleared = 0
    let persisting = 0
    for (const fault of first?.scanFaults ?? []) {
      if (fault.isApprovedException || !severitySet.has(fault.severity)) continue
      if (fault.severity !== "CRITICAL" && fault.severity !== "CALIBRATION_ONLY") {
        continue
      }
      if (fault.reconciliationBucket === "CLEARED") cleared += 1
      else if (fault.reconciliationBucket === "PERSISTING_OPEN") persisting += 1
    }
    return { items, firstFix: { cleared, total: cleared + persisting } }
  }

  // --- Baseline only (or a legacy-verified case): re-apply the engine --------
  const context = { fleetId, generation, exceptions: input.exceptions }
  const items = [...baselineByKey.entries()].map(([key, fault]) => {
    const pttStatus = toScanFaultStatus(fault.faultState)
    const decision = classifyFaultSeverity(
      {
        canonicalKey: key,
        pttStatus,
        ecuLabel: fault.controlUnit,
        description: fault.componentDescription,
      },
      context
    )
    const status: PttReportFaultStatus = fault.resolvedOnRescan
      ? "CLEARED"
      : pttStatus === "INACTIVE"
        ? "INACTIVE"
        : decision.isApprovedException
          ? "APPROVED_EXCEPTION"
          : "STILL_OPEN"
    return makeItem({
      canonicalKey: key,
      ecuLabel: fault.controlUnit.trim(),
      dtcRaw: fault.faultCode.trim(),
      description: fault.componentDescription,
      pttStatus,
      severity: resolveSeverity(decision, fault.severity),
      status,
      isBounceBack: false,
      baseline: fault,
    })
  })
  return { items, firstFix: { cleared: 0, total: 0 } }
}

const SEVERITY_TIERS: readonly PttFaultSeverity[] = PTT_FAULT_SEVERITIES

function buildTruck(
  session: PttReportCase,
  input: PttReportInput,
  ledgerByKey: ReadonlyMap<string, PttReportLedgerRow>,
  severitySet: ReadonlySet<PttFaultSeverity>
): { truck: PttReportTruck; firstFix: { cleared: number; total: number } } | null {
  const verificationScans = newestVerificationFirst(session.verificationScans)
  const latestVerification = verificationScans[0] ?? null
  const isVerified =
    latestVerification !== null ||
    (session.verificationSummary !== null &&
      session.verificationSummary !== undefined)

  const { items: allItems, firstFix } = classifyCaseFaults(
    session,
    input,
    ledgerByKey,
    severitySet,
    isVerified
  )
  const faults = allItems
    .filter((item) => severitySet.has(item.severity))
    .sort(compareRows)
  if (faults.length === 0) return null

  const caseStatus = effectiveCaseStatus(session)
  const clearedItems = isVerified
    ? faults.filter((item) => item.status === "CLEARED")
    : []
  const outstandingItems = faults
    .filter(
      (item) => item.status === "NEW_REGRESSION" || item.status === "STILL_OPEN"
    )
    .sort(
      (a, b) =>
        Number(b.status === "NEW_REGRESSION") -
          Number(a.status === "NEW_REGRESSION") || compareItems(a, b)
    )
  const approvedExceptionsCount = faults.filter(
    (item) => item.status === "APPROVED_EXCEPTION"
  ).length
  const newRegressionsCount = outstandingItems.filter(
    (item) => item.status === "NEW_REGRESSION"
  ).length

  const outstandingBySeverity: Record<PttFaultSeverity, number> = {
    CRITICAL: 0,
    CALIBRATION_ONLY: 0,
    MONITOR: 0,
    NEGLIGIBLE: 0,
  }
  for (const item of outstandingItems) outstandingBySeverity[item.severity] += 1
  const overallSeverity: PttOverallSeverity =
    SEVERITY_TIERS.find((tier) => outstandingBySeverity[tier] > 0) ?? "CLEAR"

  const clearedFaultCodes = !isVerified
    ? [AWAITING_VERIFICATION_TEXT]
    : clearedItems.length === 0
      ? [NONE_CLEARED_TEXT]
      : clearedItems.map(formatFaultLine)
  const outstandingFaultCodes =
    outstandingItems.length > 0
      ? outstandingItems.map(formatOutstandingLine)
      : [caseStatus === "VERIFIED_CLOSED" ? ALL_CLEARED_TEXT : NO_ACTIONABLE_TEXT]

  const audit = latestVerification?.verificationAudit ?? null
  const directive = session.aiDirective
  const lastVerified =
    latestVerification?.scannedAt ??
    (isVerified ? session.verifiedAt : null)

  const truck: PttReportTruck = {
    sessionId: session.id,
    fleetId: normalizeFleetId(session.fleetId),
    generation: GENERATION_LABELS[session.truckGeneration] ?? "Unknown",
    baselineDate: formatDate(session.scannedAt),
    scanDate: formatDate(latestScanAt(session)),
    lastVerifiedDate: lastVerified ? formatDate(lastVerified) : "",
    isVerified,
    caseStatus,
    caseStatusLabel: CASE_STATUS_REPORT_LABELS[caseStatus],
    closureReasonLabel:
      caseStatus === "CLOSED_ACCEPTED_RESIDUALS" && session.closureReasonCategory
        ? PTT_CLOSURE_REASON_LABELS[session.closureReasonCategory]
        : "",
    closureNote:
      caseStatus === "CLOSED_ACCEPTED_RESIDUALS"
        ? (session.closureNote?.trim() ?? "")
        : "",
    closedDate:
      caseStatus === "CLOSED_ACCEPTED_RESIDUALS" && session.closedAt
        ? formatDate(session.closedAt)
        : "",
    overallSeverity,
    clearedCount: clearedItems.length,
    outstandingCount: outstandingItems.length,
    newRegressionsCount,
    approvedExceptionsCount,
    outstandingBySeverity,
    clearedItems,
    outstandingItems,
    clearedFaultCodes,
    outstandingFaultCodes,
    approvedExceptionsNote:
      approvedExceptionsCount > 0
        ? `+${approvedExceptionsCount} approved ${approvedExceptionsCount === 1 ? "exception" : "exceptions"} excluded`
        : null,
    faults,
    verdictHeadline: audit?.verdictHeadline.trim() ?? "",
    collateralDamageAnalysis: audit?.collateralDamageAnalysis?.trim() ?? "",
    nextFloorActions: (audit?.nextFloorActions ?? [])
      .map((action) => action.trim())
      .filter(Boolean),
    trueDiagnosis: directive?.true_diagnosis.trim() ?? "",
    partsWarning: directive?.parts_cannon_warning.trim() ?? "",
    physicalChecks: (directive?.physical_inspections ?? [])
      .map((check) => check.trim())
      .filter(Boolean),
    pttPaths: (directive?.ptt_navigation_paths ?? [])
      .map((path) => path.trim())
      .filter(Boolean),
    verificationCriteria: (directive?.verification_criteria ?? [])
      .map((criterion) => criterion.trim())
      .filter(Boolean),
  }
  return { truck, firstFix }
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

const LEDGER_STATUS_PRIORITY: Record<PttLedgerStatus, number> = {
  REOPENED: 0,
  OPEN: 1,
  CLEARED: 2,
  APPROVED_EXCEPTION: 3,
}

/** Days a fault has been open: first seen -> cleared (or now), never negative. */
export function ledgerDaysOpenForReport(
  row: Pick<PttReportLedgerRow, "firstSeenAt" | "clearedAt">,
  now: Date
): number {
  return Math.max(0, daysBetween(row.firstSeenAt, row.clearedAt ?? now))
}

function buildLedgerRows(
  input: PttReportInput,
  options: ResolvedPttReportOptions,
  severitySet: ReadonlySet<PttFaultSeverity>,
  now: Date
): PttReportLedgerItem[] {
  const generationByFleet = new Map<string, string>()
  for (const session of latestSessionByFleet(input.sessions).values()) {
    const label = GENERATION_LABELS[session.truckGeneration]
    if (label) generationByFleet.set(normalizeFleetId(session.fleetId), label)
  }

  return input.ledger
    .filter((row) => {
      const fleetId = normalizeFleetId(row.fleetId)
      if (options.fleetId !== "ALL" && fleetId !== options.fleetId) return false
      return severitySet.has(row.latestSeverity)
    })
    .map((row): PttReportLedgerItem => {
      const fleetId = normalizeFleetId(row.fleetId)
      const keyGeneration = validateCanonicalKey(row.canonicalKey).generation
      return {
        fleetId,
        generation:
          generationByFleet.get(fleetId) ??
          (keyGeneration ? GENERATION_LABELS[keyGeneration] : undefined) ??
          "Unknown",
        canonicalKey: row.canonicalKey,
        ecuLabel: row.ecuLabel,
        description: row.description.trim(),
        latestSeverity: row.latestSeverity,
        ledgerStatus: row.ledgerStatus,
        firstSeenDate: formatDate(row.firstSeenAt),
        lastSeenDate: formatDate(row.lastSeenAt),
        clearedDate: row.clearedAt ? formatDate(row.clearedAt) : "",
        daysOpen: ledgerDaysOpenForReport(row, now),
        reopenCount: row.reopenCount,
        lastReopenedDate: row.lastReopenedAt
          ? formatDate(row.lastReopenedAt)
          : "",
      }
    })
    .sort(
      (a, b) =>
        compareFleetIds(a.fleetId, b.fleetId) ||
        LEDGER_STATUS_PRIORITY[a.ledgerStatus] -
          LEDGER_STATUS_PRIORITY[b.ledgerStatus] ||
        b.daysOpen - a.daysOpen ||
        a.canonicalKey.localeCompare(b.canonicalKey)
    )
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// `YYYY-MM-DD` -> local-time day boundaries (same as the HR report).
export const startOfDay = (value?: string): number | null =>
  value ? new Date(`${value}T00:00:00`).getTime() : null
export const endOfDay = (value?: string): number | null =>
  value ? new Date(`${value}T23:59:59.999`).getTime() : null

const percent = (part: number, whole: number): number | null =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 10

/**
 * Builds everything the two PDFs and the workbook print. `scope`, `fleetId`,
 * `severities`, `fromDate` / `toDate` (on the case's latest scan date) and the
 * optional `caseStatuses` pick the cases; `excludeApprovedExceptions` (default
 * `true`) only removes exception rows from the fault tables / register - the
 * exception counts always stay in the KPIs and per-truck notes.
 */
export function buildPttReportData(
  input: PttReportInput,
  options?: PttReportDataOptions,
  now: Date = new Date()
): PttReportData {
  const resolved = resolvePttReportOptions(options)
  const severitySet = new Set<PttFaultSeverity>(resolved.severities)
  const fromMs = startOfDay(resolved.fromDate)
  const toMs = endOfDay(resolved.toDate)

  const ledgerByKey = new Map<string, PttReportLedgerRow>()
  for (const row of input.ledger) {
    ledgerByKey.set(`${normalizeFleetId(row.fleetId)}|${row.canonicalKey}`, row)
  }

  let scoped: readonly PttReportCase[]
  if (resolved.scope === "ALL_SCANS") {
    scoped = input.sessions
  } else {
    const latest = [...latestSessionByFleet(input.sessions).values()]
    scoped =
      resolved.scope === "LATEST_OPEN"
        ? latest.filter(
            (session) => !isClosedCaseStatus(effectiveCaseStatus(session))
          )
        : latest
  }

  const matched = scoped.filter((session) => {
    if (
      resolved.fleetId !== "ALL" &&
      normalizeFleetId(session.fleetId) !== resolved.fleetId
    ) {
      return false
    }
    if (
      resolved.caseStatuses.length > 0 &&
      !resolved.caseStatuses.includes(effectiveCaseStatus(session))
    ) {
      return false
    }
    const scannedMs = latestScanAt(session).getTime()
    if (fromMs !== null && scannedMs < fromMs) return false
    if (toMs !== null && scannedMs > toMs) return false
    return true
  })

  const built: {
    truck: PttReportTruck
    firstFix: { cleared: number; total: number }
    scannedMs: number
  }[] = []
  for (const session of matched) {
    const result = buildTruck(session, input, ledgerByKey, severitySet)
    if (result) {
      built.push({ ...result, scannedMs: latestScanAt(session).getTime() })
    }
  }
  built.sort(
    (a, b) =>
      b.scannedMs - a.scannedMs ||
      compareFleetIds(a.truck.fleetId, b.truck.fleetId) ||
      b.truck.sessionId - a.truck.sessionId
  )
  const trucks = built.map((entry) => entry.truck)

  const faultRows: PttReportFaultRow[] = []
  let excludedExceptionRows = 0
  for (const truck of trucks) {
    for (const fault of truck.faults) {
      if (fault.status === "APPROVED_EXCEPTION") {
        if (resolved.excludeApprovedExceptions) {
          excludedExceptionRows += 1
          continue
        }
      }
      faultRows.push({
        ...fault,
        scanDate: truck.scanDate,
        fleetId: truck.fleetId,
        generation: truck.generation,
        sessionId: truck.sessionId,
      })
    }
  }

  const sum = (pick: (truck: PttReportTruck) => number) =>
    trucks.reduce((total, truck) => total + pick(truck), 0)
  const firstFixCleared = built.reduce(
    (total, entry) => total + entry.firstFix.cleared,
    0
  )
  const firstFixTotal = built.reduce(
    (total, entry) => total + entry.firstFix.total,
    0
  )

  const kpis: PttReportKpis = {
    trucksCount: trucks.length,
    // Neither a clean closure nor a manager release counts as open / blocked.
    openOrBlockedCount: trucks.filter(
      (truck) => !isClosedCaseStatus(truck.caseStatus)
    ).length,
    verifiedClosedCount: trucks.filter(
      (truck) => truck.caseStatus === "VERIFIED_CLOSED"
    ).length,
    actionableCriticalCount: sum((t) => t.outstandingBySeverity.CRITICAL),
    calibrationOnlyCount: sum((t) => t.outstandingBySeverity.CALIBRATION_ONLY),
    verifiedClearedCount: sum((t) => t.clearedCount),
    outstandingActionableCount: sum((t) => t.outstandingCount),
    newRegressionsCount: sum((t) => t.newRegressionsCount),
    approvedExceptionsCount: sum((t) => t.approvedExceptionsCount),
    firstTimeFixRatePct: percent(firstFixCleared, firstFixTotal),
  }

  return {
    options: resolved,
    generatedAt: now,
    trucks,
    faultRows,
    excludedExceptionRows,
    ledgerRows: buildLedgerRows(input, resolved, severitySet, now),
    kpis,
  }
}
