import type { PttFaultSeverity } from "../ptt-diagnostics"
import type { PttCaseStatus } from "./constants"

// Pure pieces of the workshop accountability KPIs (no DB), so the rules are
// unit-testable and shared with the query layer.

/** Case verdicts that still need workshop attention. */
const OPEN_BLOCKED_CASE_STATUSES: readonly PttCaseStatus[] = [
  "OPEN",
  "PARTIAL_BLOCKED",
  "REJECTED_NO_PROGRESS",
]

const BLOCKING_SEVERITIES: readonly PttFaultSeverity[] = [
  "CRITICAL",
  "CALIBRATION_ONLY",
]

/**
 * "Open or Blocked Trucks": trucks whose latest case is still open / blocked
 * AND carry a Critical or Calibration fault. Neither a clean closure
 * (VERIFIED_CLOSED) nor a manager release (CLOSED_ACCEPTED_RESIDUALS) counts.
 */
export function countOpenBlockingTrucks(
  latestBaselines: ReadonlyArray<{
    caseStatus: PttCaseStatus
    overallSeverity: string
  }>
): number {
  return latestBaselines.filter(
    (truck) =>
      OPEN_BLOCKED_CASE_STATUSES.includes(truck.caseStatus) &&
      BLOCKING_SEVERITIES.includes(truck.overallSeverity as PttFaultSeverity)
  ).length
}

/**
 * Fleet Coverage quick filter "Blocked (Has After Photo)": the truck's latest
 * case has a saved after-work scan, still has blocking faults and has not been
 * released yet, so it is a candidate for "Close Job (Accept Residuals)".
 */
export function isBlockedWithAfterPhoto(truck: {
  caseStatus: PttCaseStatus
  hasVerificationScan: boolean
}): boolean {
  return (
    truck.hasVerificationScan &&
    (truck.caseStatus === "PARTIAL_BLOCKED" ||
      truck.caseStatus === "REJECTED_NO_PROGRESS")
  )
}
