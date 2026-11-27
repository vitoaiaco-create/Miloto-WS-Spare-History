// Client-safe constants and types for the Before/After fault reconciliation
// engine (Fleet Diagnostics / PTT Intel). Like src/lib/ptt-diagnostics.ts this
// file must NOT import `@/db/schema` (Client Components import it, and
// drizzle-kit loads schema.ts without the `@/` alias, so schema.ts imports this
// file by relative path).

export const PTT_KNOWN_GENERATIONS = ["FH_V3", "FH_V4"] as const
export type PttKnownGeneration = (typeof PTT_KNOWN_GENERATIONS)[number]

export const PTT_SCAN_ROLES = ["BASELINE", "VERIFICATION"] as const
export type PttScanRole = (typeof PTT_SCAN_ROLES)[number]

export const PTT_CASE_STATUSES = [
  "OPEN",
  "PARTIAL_BLOCKED",
  "VERIFIED_CLOSED",
  "REJECTED_INCOMPLETE",
  "REJECTED_NO_PROGRESS",
  "CLOSED_ACCEPTED_RESIDUALS",
] as const
export type PttCaseStatus = (typeof PTT_CASE_STATUSES)[number]

export const PTT_CASE_STATUS_LABELS: Record<PttCaseStatus, string> = {
  OPEN: "OPEN",
  PARTIAL_BLOCKED: "PARTIAL / BLOCKED",
  VERIFIED_CLOSED: "VERIFIED CLOSED",
  REJECTED_INCOMPLETE: "INCOMPLETE REJECTED",
  REJECTED_NO_PROGRESS: "NO PROGRESS REJECTED",
  CLOSED_ACCEPTED_RESIDUALS: "CLOSED (ACCEPTED RESIDUALS)",
}

/** Case verdicts that count as finished: nothing is open or blocked any more. */
export const PTT_CLOSED_CASE_STATUSES: readonly PttCaseStatus[] = [
  "VERIFIED_CLOSED",
  "CLOSED_ACCEPTED_RESIDUALS",
]

export function isClosedCaseStatus(status: PttCaseStatus): boolean {
  return PTT_CLOSED_CASE_STATUSES.includes(status)
}

/** How a case was closed (`ptt_diagnostic_sessions.closure_mode`). */
export const PTT_CLOSURE_MODES = ["CLEAN", "ACCEPTED_RESIDUALS"] as const
export type PttClosureMode = (typeof PTT_CLOSURE_MODES)[number]

/** Why a manager closed a job while faults were still open. */
export const PTT_CLOSURE_REASON_CATEGORIES = [
  "UNUSED_DISCONNECTED_SENSOR",
  "HARDWARE_CONVERSION",
  "DEFERRED_TO_PM",
  "OCR_ARTIFACT",
  "MANAGER_RELEASE",
] as const
export type PttClosureReasonCategory =
  (typeof PTT_CLOSURE_REASON_CATEGORIES)[number]

export const PTT_CLOSURE_REASON_LABELS: Record<PttClosureReasonCategory, string> =
  {
    UNUSED_DISCONNECTED_SENSOR: "Unused / disconnected sensor",
    HARDWARE_CONVERSION: "Hardware conversion",
    DEFERRED_TO_PM: "Deferred to PM service",
    OCR_ARTIFACT: "OCR artifact",
    MANAGER_RELEASE: "Manager release",
  }

/** Minimum length of the audit note on an accepted-residuals closure. */
export const PTT_CLOSURE_NOTE_MIN_LENGTH = 5

// Only ACTIVE / INACTIVE exist in the reconciliation model. A fault whose
// state could not be read ("UNKNOWN" in the OCR output) is stored as ACTIVE so
// it can never be credited as cleared by an unreadable screenshot.
export const PTT_SCAN_FAULT_STATUSES = ["ACTIVE", "INACTIVE"] as const
export type PttScanFaultStatus = (typeof PTT_SCAN_FAULT_STATUSES)[number]

export const PTT_RECONCILIATION_BUCKETS = [
  "CLEARED",
  "PERSISTING_OPEN",
  "PERSISTING_EXCEPTION",
  "NEW_REGRESSION",
  "NEW_EXCEPTION",
] as const
export type PttReconciliationBucket = (typeof PTT_RECONCILIATION_BUCKETS)[number]

export const PTT_LEDGER_STATUSES = [
  "OPEN",
  "CLEARED",
  "REOPENED",
  "APPROVED_EXCEPTION",
] as const
export type PttLedgerStatus = (typeof PTT_LEDGER_STATUSES)[number]

export const PTT_EXCEPTION_SCOPES = ["FLEET_GENERATION", "TRUCK_SPECIFIC"] as const
export type PttExceptionScope = (typeof PTT_EXCEPTION_SCOPES)[number]

export const PTT_EXCEPTION_REASON_CATEGORIES = [
  "MANUAL_AIR_DRYER",
  "MANUAL_LOAD_VALVE",
  "UNFITTED_AUTO_GREASE",
  "NON_RETARDER_GEARBOX",
  "UNUSED_AUX_MODULE",
  "NO_WASHER_SENSOR",
  "OTHER",
] as const
export type PttExceptionReasonCategory =
  (typeof PTT_EXCEPTION_REASON_CATEGORIES)[number]

export const PTT_EXCEPTION_REASON_LABELS: Record<
  PttExceptionReasonCategory,
  string
> = {
  MANUAL_AIR_DRYER: "Manual air dryer conversion",
  MANUAL_LOAD_VALVE: "Manual rear load-sensing valve",
  UNFITTED_AUTO_GREASE: "Automatic chassis lube not fitted",
  NON_RETARDER_GEARBOX: "Gearbox without retarder",
  UNUSED_AUX_MODULE: "Unused auxiliary module",
  NO_WASHER_SENSOR: "No washer-fluid sensor fitted",
  OTHER: "Other (explain in proof note)",
}

// A fault whose cleared-then-reappeared gap is at most this long is a
// "bounce-back" (the repair did not hold).
export const PTT_BOUNCE_BACK_WINDOW_DAYS = 30

// Counts stored in `ptt_diagnostic_sessions.reconciliation_summary`.
// Invariant: baselineActiveCount - clearedCount + newRegressionCount
//            + newExceptionCount = verificationActiveCount.
export type PttReconciliationSummary = {
  baselineActiveCount: number
  verificationActiveCount: number
  clearedCount: number
  persistingOpenCount: number
  persistingExceptionCount: number
  newRegressionCount: number
  newExceptionCount: number
  bounceBackCount: number
}

export const PTT_GATE_NAMES = ["INCOMPLETE_SCAN", "TRUCK_MISMATCH"] as const
export type PttGateName = (typeof PTT_GATE_NAMES)[number]

// Audit entry for a manager overriding an integrity gate.
export type PttGateOverride = {
  gate: PttGateName
  reason: string
  by: string
  at: string
}
