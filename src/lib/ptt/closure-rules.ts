import type { PttFaultSeverity } from "../ptt-diagnostics"
import {
  PTT_CLOSURE_NOTE_MIN_LENGTH,
  isClosedCaseStatus,
  type PttCaseStatus,
  type PttReconciliationBucket,
} from "./constants"
import type { LedgerEntry } from "./ledger"
import { isBlockingSeverity } from "./reconcile"

// Pure rules for "Close Job (Accept Residual Faults)": who may close a case
// this way, which faults count as the accepted residuals, and what the truck
// ledger does with them. Client-safe so the dialog and the Server Action share
// one rule.

export const CLOSE_JOB_BLOCKED_BASELINE_MESSAGE =
  "This case has no after-work (verification) scan and still has Critical or Calibration faults. Upload the post-work PTT scan first, or approve exceptions for those faults."
export const CLOSE_JOB_ALREADY_CLOSED_MESSAGE = "This case is already closed."
export const CLOSE_JOB_NOT_ELIGIBLE_MESSAGE =
  "Only a case with a blocked or no-progress verification scan (or a baseline with no Critical / Calibration faults) can be closed with accepted residuals."

/** Case verdicts of a saved verification scan that may be closed by a manager. */
const CLOSABLE_VERIFIED_STATUSES: readonly PttCaseStatus[] = [
  "PARTIAL_BLOCKED",
  "REJECTED_NO_PROGRESS",
]

export type ClosureEligibilityInput = {
  /** The case-level verdict stored on the baseline. */
  caseStatus: PttCaseStatus
  /** A verification scan (the "AFTER photo") has been saved. */
  hasVerificationScan: boolean
  /** Active, non-exempt baseline faults that block (CRITICAL / CALIBRATION_ONLY). */
  baselineActionableCount: number
}

export type ClosureEligibility =
  | { allowed: true; basis: "VERIFICATION_SCAN" | "ZERO_CRITICAL_BASELINE" }
  | { allowed: false; reason: string }

/**
 * Who may close a case with accepted residuals:
 *  - a saved verification scan whose verdict is PARTIAL_BLOCKED or
 *    REJECTED_NO_PROGRESS (the manager accepts what the re-scan still shows);
 *  - a baseline-only (OPEN) case that has no actionable Critical /
 *    Calibration fault at all (nothing blocking to accept).
 * A baseline-only case with at least one actionable fault stays blocked.
 */
export function evaluateClosureEligibility(
  input: ClosureEligibilityInput
): ClosureEligibility {
  if (isClosedCaseStatus(input.caseStatus)) {
    return { allowed: false, reason: CLOSE_JOB_ALREADY_CLOSED_MESSAGE }
  }
  if (input.hasVerificationScan) {
    return CLOSABLE_VERIFIED_STATUSES.includes(input.caseStatus)
      ? { allowed: true, basis: "VERIFICATION_SCAN" }
      : { allowed: false, reason: CLOSE_JOB_NOT_ELIGIBLE_MESSAGE }
  }
  if (input.caseStatus !== "OPEN") {
    return { allowed: false, reason: CLOSE_JOB_NOT_ELIGIBLE_MESSAGE }
  }
  return input.baselineActionableCount === 0
    ? { allowed: true, basis: "ZERO_CRITICAL_BASELINE" }
    : { allowed: false, reason: CLOSE_JOB_BLOCKED_BASELINE_MESSAGE }
}

/** Convenience for the UI: the eligibility verdict as a boolean. */
export const canCloseWithAcceptedResiduals = (
  input: ClosureEligibilityInput
): boolean => evaluateClosureEligibility(input).allowed

/** Trimmed closure note long enough to be a real justification. */
export const isValidClosureNote = (note: string): boolean =>
  note.trim().length >= PTT_CLOSURE_NOTE_MIN_LENGTH

export type ResidualFault = {
  canonicalKey: string
  ecuLabel: string
  description: string
  severity: PttFaultSeverity
}

/** Active baseline faults that block a closure (CRITICAL / CALIBRATION_ONLY). */
export function countActionableBaselineFaults(
  faults: ReadonlyArray<{
    pttStatus: "ACTIVE" | "INACTIVE"
    severity: PttFaultSeverity
    isApprovedException: boolean
  }>
): number {
  return faults.filter(
    (fault) =>
      fault.pttStatus === "ACTIVE" &&
      !fault.isApprovedException &&
      isBlockingSeverity(fault.severity)
  ).length
}

type ReconciledResidual = ResidualFault & { bucket: PttReconciliationBucket }

/**
 * The faults being accepted. With a verification scan: everything the re-scan
 * still shows open (NEW_REGRESSION + PERSISTING_OPEN). Baseline-only: every
 * active, non-exempt baseline fault (by eligibility these are all
 * non-blocking, e.g. MONITOR). Distinct by canonical key, stable order.
 */
export function collectClosureResiduals(input: {
  reconciled: readonly ReconciledResidual[] | null
  baseline: ReadonlyArray<
    ResidualFault & { pttStatus: "ACTIVE" | "INACTIVE"; isApprovedException: boolean }
  >
}): ResidualFault[] {
  const source: ResidualFault[] =
    input.reconciled !== null
      ? input.reconciled.filter(
          (fault) =>
            fault.bucket === "NEW_REGRESSION" || fault.bucket === "PERSISTING_OPEN"
        )
      : input.baseline.filter(
          (fault) => fault.pttStatus === "ACTIVE" && !fault.isApprovedException
        )
  const byKey = new Map<string, ResidualFault>()
  for (const fault of source) {
    if (!byKey.has(fault.canonicalKey)) {
      byKey.set(fault.canonicalKey, {
        canonicalKey: fault.canonicalKey,
        ecuLabel: fault.ecuLabel,
        description: fault.description,
        severity: fault.severity,
      })
    }
  }
  return [...byKey.values()]
}

/**
 * Ledger rows to write for a closure that does NOT go through a verification
 * re-reconcile (baseline-only closures): accepted residuals saved as
 * exceptions become APPROVED_EXCEPTION; with `saveResidualsAsExceptions`
 * false nothing changes and the faults stay OPEN.
 */
export function planClosureLedgerUpserts(input: {
  residualKeys: readonly string[]
  saveResidualsAsExceptions: boolean
  ledger: ReadonlyMap<string, LedgerEntry>
}): LedgerEntry[] {
  if (!input.saveResidualsAsExceptions) return []
  const upserts: LedgerEntry[] = []
  for (const key of input.residualKeys) {
    const entry = input.ledger.get(key)
    if (
      entry &&
      (entry.ledgerStatus === "OPEN" || entry.ledgerStatus === "REOPENED")
    ) {
      upserts.push({ ...entry, ledgerStatus: "APPROVED_EXCEPTION" })
    }
  }
  return upserts
}
