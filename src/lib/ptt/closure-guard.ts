import type { PttCaseStatus } from "./constants"

// Guard for the manual workflow-status dropdown: a case may only reach
// VERIFIED_CLOSED through a passing post-work verification scan (or an
// exception approval that makes the latest scan pass), never by hand while
// blocking faults or regressions remain. Pure and client-safe, so the Server
// Action and the dropdown share one rule.

export const MANUAL_CLOSE_BLOCKED_MESSAGE =
  "Cannot manually mark Verified Closed while blocking faults or regressions remain open. Upload a passing post-work PTT verification scan."

/** Shown under the workflow dropdown while `Verified Closed` is disabled. */
export const MANUAL_CLOSE_HINT =
  "Verified Closed needs a passing post-work PTT verification scan."

export type ManualClosureInput = {
  /** The case-level verdict stored on the baseline session. */
  caseStatus: PttCaseStatus
  /** Verdict of the newest verification scan; `null` when none was uploaded. */
  latestVerificationCaseStatus: PttCaseStatus | null
}

/**
 * True when setting the workflow status to `VERIFIED_CLOSED` is allowed.
 * Blocked when the case is `OPEN`, `PARTIAL_BLOCKED` or
 * `REJECTED_NO_PROGRESS` (or any other non-closed verdict), or when there is
 * no passing verification scan. A case that is already `VERIFIED_CLOSED` by a
 * passing scan stays closable.
 */
export function canManuallyMarkVerifiedClosed(
  input: ManualClosureInput
): boolean {
  return (
    input.caseStatus === "VERIFIED_CLOSED" &&
    input.latestVerificationCaseStatus === "VERIFIED_CLOSED"
  )
}
