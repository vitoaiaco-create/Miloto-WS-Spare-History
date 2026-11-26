import type { PttFaultSeverity, PttTruckGeneration } from "../ptt-diagnostics"
import type {
  PttCaseStatus,
  PttExceptionScope,
  PttKnownGeneration,
  PttReconciliationBucket,
  PttReconciliationSummary,
  PttScanFaultStatus,
} from "./constants"

// Pure 5-way set-diff between a BASELINE scan and a post-work VERIFICATION
// scan. No I/O, no clock, no randomness: the same input always yields the same
// buckets and case status. Only ACTIVE faults take part in the diff.

const SEVERITY_ORDER: Record<PttFaultSeverity, number> = {
  CRITICAL: 4,
  CALIBRATION_ONLY: 3,
  MONITOR: 2,
  NEGLIGIBLE: 1,
}

/** Severities that block a closure while still open. */
export function isBlockingSeverity(severity: PttFaultSeverity): boolean {
  return severity === "CRITICAL" || severity === "CALIBRATION_ONLY"
}

export type ReconcileFault = {
  canonicalKey: string
  pttStatus: PttScanFaultStatus
  severity: PttFaultSeverity
  ecuLabel?: string
  dtcRaw?: string
  description?: string
}

/** The fields of an approved-exception row the engine needs. */
export type ApprovedExceptionRule = {
  scope: PttExceptionScope
  generation: PttKnownGeneration | null
  fleetId: string | null
  canonicalKey: string
  isActive: boolean
}

export type ReconciledFault = {
  canonicalKey: string
  bucket: PttReconciliationBucket
  /** Worst severity seen for this key across the two scans. */
  severity: PttFaultSeverity
  isApprovedException: boolean
  isBounceBack: boolean
  ecuLabel: string
  dtcRaw: string
  description: string
  /** Whether the key was readable on the verification screenshots. */
  presentInVerification: boolean
  verificationStatus: PttScanFaultStatus | null
}

export type ReconcileInput = {
  fleetId: string
  generation: PttTruckGeneration
  baselineFaults: readonly ReconcileFault[]
  verificationFaults: readonly ReconcileFault[]
  exceptions: readonly ApprovedExceptionRule[]
  /** Active keys the ledger flagged as 30-day bounce-backs. */
  bounceBackKeys?: ReadonlySet<string>
}

export type ReconcileResult = {
  buckets: Record<PttReconciliationBucket, ReconciledFault[]>
  /** Every classified fault in a stable order (bucket priority, severity, key). */
  faults: ReconciledFault[]
  hasBlockingPersisting: boolean
  hasRegressions: boolean
  clearedActionableCount: number
  caseStatus: PttCaseStatus
  summary: PttReconciliationSummary
}

const normalizeFleet = (value: string) => value.trim().toUpperCase()

/**
 * True when `canonicalKey` is covered by an active approved exception for the
 * truck: either a FLEET_GENERATION rule for the truck's generation or a
 * TRUCK_SPECIFIC rule for the fleet id.
 */
export function matchesApprovedException(
  exceptions: readonly ApprovedExceptionRule[],
  fleetId: string,
  generation: PttTruckGeneration,
  canonicalKey: string
): boolean {
  const fleet = normalizeFleet(fleetId)
  return exceptions.some(
    (rule) =>
      rule.isActive &&
      rule.canonicalKey === canonicalKey &&
      ((rule.scope === "FLEET_GENERATION" && rule.generation === generation) ||
        (rule.scope === "TRUCK_SPECIFIC" &&
          rule.fleetId !== null &&
          normalizeFleet(rule.fleetId) === fleet))
  )
}

// One entry per canonical key. ACTIVE beats INACTIVE and the worse severity
// wins, so a repeated row can never hide a live fault.
function indexFaults(
  faults: readonly ReconcileFault[]
): Map<string, ReconcileFault> {
  const byKey = new Map<string, ReconcileFault>()
  for (const fault of faults) {
    const existing = byKey.get(fault.canonicalKey)
    if (!existing) {
      byKey.set(fault.canonicalKey, fault)
      continue
    }
    const active =
      existing.pttStatus === "ACTIVE" || fault.pttStatus === "ACTIVE"
        ? "ACTIVE"
        : "INACTIVE"
    const worse =
      SEVERITY_ORDER[fault.severity] > SEVERITY_ORDER[existing.severity]
        ? fault
        : existing
    byKey.set(fault.canonicalKey, { ...worse, pttStatus: active })
  }
  return byKey
}

const BUCKET_PRIORITY: Record<PttReconciliationBucket, number> = {
  NEW_REGRESSION: 0,
  PERSISTING_OPEN: 1,
  CLEARED: 2,
  PERSISTING_EXCEPTION: 3,
  NEW_EXCEPTION: 4,
}

function emptyBuckets(): Record<PttReconciliationBucket, ReconciledFault[]> {
  return {
    CLEARED: [],
    PERSISTING_OPEN: [],
    PERSISTING_EXCEPTION: [],
    NEW_REGRESSION: [],
    NEW_EXCEPTION: [],
  }
}

/**
 * Reconciles a baseline against a verification scan.
 *
 * Buckets (mutually exclusive, ACTIVE faults only):
 *  - CLEARED:              active in baseline; absent or INACTIVE in verification
 *  - PERSISTING_OPEN:      active in both, not an approved exception
 *  - PERSISTING_EXCEPTION: active in both, approved exception
 *  - NEW_REGRESSION:       not active in baseline, active in verification, not an exception
 *  - NEW_EXCEPTION:        not active in baseline, active in verification, approved exception
 *
 * Case status:
 *  - nothing actionable cleared AND (blocking persisting OR regressions) -> REJECTED_NO_PROGRESS
 *  - else blocking persisting OR regressions                            -> PARTIAL_BLOCKED
 *  - else                                                               -> VERIFIED_CLOSED
 */
export function reconcileDiagnosticScans(input: ReconcileInput): ReconcileResult {
  const baseline = indexFaults(input.baselineFaults)
  const verification = indexFaults(input.verificationFaults)
  const bounceBackKeys = input.bounceBackKeys ?? new Set<string>()

  const baselineActive = new Map(
    [...baseline].filter(([, fault]) => fault.pttStatus === "ACTIVE")
  )
  const verificationActive = new Map(
    [...verification].filter(([, fault]) => fault.pttStatus === "ACTIVE")
  )

  const isException = (key: string) =>
    matchesApprovedException(
      input.exceptions,
      input.fleetId,
      input.generation,
      key
    )

  const buckets = emptyBuckets()

  const classify = (
    key: string,
    bucket: PttReconciliationBucket,
    before: ReconcileFault | undefined,
    after: ReconcileFault | undefined
  ) => {
    const source = after ?? before
    if (!source) return
    const severities = [before?.severity, after?.severity].filter(
      (s): s is PttFaultSeverity => s !== undefined
    )
    const severity = severities.reduce((worst, s) =>
      SEVERITY_ORDER[s] > SEVERITY_ORDER[worst] ? s : worst
    )
    buckets[bucket].push({
      canonicalKey: key,
      bucket,
      severity,
      isApprovedException: isException(key),
      isBounceBack: after !== undefined && bounceBackKeys.has(key),
      ecuLabel: source.ecuLabel ?? "",
      dtcRaw: source.dtcRaw ?? "",
      description: source.description ?? before?.description ?? "",
      presentInVerification: after !== undefined,
      verificationStatus: after?.pttStatus ?? null,
    })
  }

  for (const [key, before] of baselineActive) {
    const after = verification.get(key)
    if (!verificationActive.has(key)) {
      classify(key, "CLEARED", before, after)
    } else {
      classify(
        key,
        isException(key) ? "PERSISTING_EXCEPTION" : "PERSISTING_OPEN",
        before,
        after
      )
    }
  }
  for (const [key, after] of verificationActive) {
    if (baselineActive.has(key)) continue
    classify(key, isException(key) ? "NEW_EXCEPTION" : "NEW_REGRESSION", undefined, after)
  }

  const order = (a: ReconciledFault, b: ReconciledFault) =>
    BUCKET_PRIORITY[a.bucket] - BUCKET_PRIORITY[b.bucket] ||
    SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
    a.canonicalKey.localeCompare(b.canonicalKey)
  for (const bucket of Object.values(buckets)) bucket.sort(order)

  const hasBlockingPersisting = buckets.PERSISTING_OPEN.some((fault) =>
    isBlockingSeverity(fault.severity)
  )
  const hasRegressions = buckets.NEW_REGRESSION.length > 0
  const clearedActionableCount = buckets.CLEARED.filter(
    (fault) => !fault.isApprovedException
  ).length

  const caseStatus: PttCaseStatus =
    hasBlockingPersisting || hasRegressions
      ? clearedActionableCount === 0
        ? "REJECTED_NO_PROGRESS"
        : "PARTIAL_BLOCKED"
      : "VERIFIED_CLOSED"

  const faults = Object.values(buckets).flat().sort(order)

  return {
    buckets,
    faults,
    hasBlockingPersisting,
    hasRegressions,
    clearedActionableCount,
    caseStatus,
    summary: {
      baselineActiveCount: baselineActive.size,
      verificationActiveCount: verificationActive.size,
      clearedCount: buckets.CLEARED.length,
      persistingOpenCount: buckets.PERSISTING_OPEN.length,
      persistingExceptionCount: buckets.PERSISTING_EXCEPTION.length,
      newRegressionCount: buckets.NEW_REGRESSION.length,
      newExceptionCount: buckets.NEW_EXCEPTION.length,
      bounceBackCount: faults.filter((fault) => fault.isBounceBack).length,
    },
  }
}
