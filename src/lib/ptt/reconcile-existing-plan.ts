import {
  summarizePttFaults,
  type PttFaultSeverity,
  type PttFaultSummary,
  type PttSessionStatus,
  type PttTruckGeneration,
} from "../ptt-diagnostics"
import type {
  PttCaseStatus,
  PttClosureMode,
  PttClosureReasonCategory,
  PttReconciliationBucket,
  PttReconciliationSummary,
  PttScanFaultStatus,
} from "./constants"
import {
  applyUpserts,
  mergeLedgerEntries,
  planLedgerCommit,
  type LedgerEntry,
  type LedgerScanFault,
} from "./ledger"
import {
  matchesApprovedException,
  reconcileDiagnosticScans,
  type ApprovedExceptionRule,
  type ReconcileResult,
} from "./reconcile"
import {
  buildScanKeyContext,
  rekeyScanFaultRecord,
  scanRowTextOf,
  type ScanFaultRecord,
} from "./scan-faults"
import {
  classifyFaultSeverity,
  resolveSeverity,
  type SeverityContext,
} from "./severity-and-patterns"

// Pure planner behind `reconcileExistingCase`: given what is stored for one
// case (baseline + latest verification scan, their fault rows, the active
// exceptions, the truck ledger) it returns every write needed to bring the
// case in line with the current key normaliser, severity engine and
// reconciliation rules. No I/O and no clock: the only dates it writes are the
// stored ones (`baselineScannedAt` / `verificationScannedAt`), so a
// re-reconcile never moves a scan's history to "today" and the whole
// retrospective repair is unit-testable.

/** A `ptt_scan_faults` row; `id` is null for a row that is not stored yet. */
export type StoredFaultRow = {
  id: number | null
  canonicalKey: string
  ecuLabel: string
  dtcRaw: string
  description: string
  pttStatus: PttScanFaultStatus
  severity: PttFaultSeverity
  reconciliationBucket: PttReconciliationBucket | null
  isBounceBack: boolean
  isApprovedException: boolean
  isExtracted: boolean
  keyNeedsReview: boolean
  keyReviewReason: string | null
}

/** An active exception; `createdByClosure` marks one a manager made while closing this very case. */
export type PlanException = ApprovedExceptionRule & { createdByClosure?: boolean }

export type CaseSessionState = {
  caseStatus: PttCaseStatus
  workflowStatus: PttSessionStatus
  verifiedAt: Date | null
  closureMode: PttClosureMode | null
  closureReasonCategory: PttClosureReasonCategory | null
  closureNote: string | null
  closedBy: string | null
  closedAt: Date | null
}

export type ReconcileExistingInput = {
  fleetId: string
  generation: PttTruckGeneration
  baselineScanId: number
  baselineScannedAt: Date
  verificationScanId: number
  baselineRows: readonly StoredFaultRow[]
  verificationRows: readonly StoredFaultRow[]
  exceptions: readonly PlanException[]
  ledger: ReadonlyMap<string, LedgerEntry>
  session: CaseSessionState
  /**
   * When the verification scan's photos were actually uploaded
   * (`scannedAt`). Every date the plan has to fill in (first-time `verifiedAt`
   * / `closedAt`, ledger sightings and clearances) is anchored to it, never to
   * the wall clock: re-reconciling must not move history to "today".
   */
  verificationScannedAt: Date
}

export type ScanFaultValues = {
  canonicalKey: string
  pttStatus: PttScanFaultStatus
  severity: PttFaultSeverity
  description: string
  reconciliationBucket: PttReconciliationBucket | null
  isApprovedException: boolean
  isBounceBack: boolean
  keyNeedsReview: boolean
  keyReviewReason: string | null
}

export type NewScanFaultRow = ScanFaultValues & {
  ecuLabel: string
  dtcRaw: string
  isExtracted: boolean
}

export type ScanFaultPlan = {
  /** Duplicates that collapsed onto another key, and stale synthetic rows. */
  deleteIds: number[]
  /** Ordered so a key is never taken before its previous holder has left it. */
  updates: Array<{ id: number; values: ScanFaultValues }>
  inserts: NewScanFaultRow[]
}

export type SessionPlan = CaseSessionState & {
  reconciliationSummary: PttReconciliationSummary
}

export type ReconcileExistingPlan = {
  baseline: ScanFaultPlan
  verification: ScanFaultPlan
  session: SessionPlan
  verificationCounts: PttFaultSummary
  ledgerUpserts: LedgerEntry[]
  /** Old keys that were repaired; their ledger rows are orphans unless another case still uses them. */
  orphanLedgerKeyCandidates: string[]
  repairedKeysCount: number
  upgradedToClean: boolean
  result: ReconcileResult
}

const SEVERITY_ORDER: Record<PttFaultSeverity, number> = {
  CRITICAL: 4,
  CALIBRATION_ONLY: 3,
  MONITOR: 2,
  NEGLIGIBLE: 1,
}

type KeyedRow = {
  row: StoredFaultRow
  record: ScanFaultRecord
}

type MergedRecord = {
  record: ScanFaultRecord
  isBounceBack: boolean
  /** The stored row that keeps the merged data (null: nothing stored yet). */
  survivor: StoredFaultRow | null
  /** Other stored rows folded into this key. */
  folded: StoredFaultRow[]
  /** Previous keys of every row that landed here (for the repair count). */
  previousKeys: string[]
}

function toRecord(row: StoredFaultRow): ScanFaultRecord {
  return {
    canonicalKey: row.canonicalKey,
    ecuLabel: row.ecuLabel,
    dtcRaw: row.dtcRaw,
    description: row.description,
    pttStatus: row.pttStatus,
    severity: row.severity,
    keyNeedsReview: row.keyNeedsReview,
    keyReviewReason: row.keyReviewReason,
    isVcads: row.canonicalKey.startsWith("VCADS|"),
  }
}

// Re-normalises each stored row and collapses rows that now share a key
// (ACTIVE beats INACTIVE, the worse severity and the fuller description win).
function rekeyAndMerge(
  rows: readonly StoredFaultRow[],
  generation: PttTruckGeneration
): MergedRecord[] {
  // Scan-level context (e.g. "this scan has Retarder faults") comes from EVERY
  // row of the scan, before any single row is re-keyed.
  const scanContext = buildScanKeyContext(
    rows.map((row) => scanRowTextOf(toRecord(row))),
    generation
  )
  const groups = new Map<string, KeyedRow[]>()
  for (const row of rows) {
    const record = rekeyScanFaultRecord(toRecord(row), generation, scanContext)
    const group = groups.get(record.canonicalKey) ?? []
    group.push({ row, record })
    groups.set(record.canonicalKey, group)
  }

  return [...groups.values()].map((group) => {
    const stored = group.filter(({ row }) => row.id !== null)
    // Prefer the row that already holds the key (it needs no re-keying).
    const survivor =
      stored.find(({ row, record }) => row.canonicalKey === record.canonicalKey) ??
      stored[0] ??
      null

    const first = group[0].record
    const merged = group.slice(1).reduce<ScanFaultRecord>(
      (acc, { record }) => ({
        ...acc,
        pttStatus:
          acc.pttStatus === "ACTIVE" || record.pttStatus === "ACTIVE"
            ? "ACTIVE"
            : "INACTIVE",
        severity:
          SEVERITY_ORDER[record.severity] > SEVERITY_ORDER[acc.severity]
            ? record.severity
            : acc.severity,
        description:
          record.description.length > acc.description.length
            ? record.description
            : acc.description,
        keyNeedsReview: acc.keyNeedsReview || record.keyNeedsReview,
        keyReviewReason: acc.keyReviewReason ?? record.keyReviewReason,
      }),
      first
    )

    return {
      record: merged,
      isBounceBack: group.some(({ row }) => row.isBounceBack),
      survivor: survivor?.row ?? null,
      folded: stored
        .filter(({ row }) => row !== survivor?.row)
        .map(({ row }) => row),
      previousKeys: group.map(({ row }) => row.canonicalKey),
    }
  })
}

type Evaluation = {
  baselineRecords: ScanFaultRecord[]
  verificationRecords: ScanFaultRecord[]
  result: ReconcileResult
  isException: (key: string) => boolean
}

function evaluate(
  input: ReconcileExistingInput,
  baselineMerged: readonly MergedRecord[],
  verificationMerged: readonly MergedRecord[],
  exceptions: readonly ApprovedExceptionRule[],
  bounceBackKeys: ReadonlySet<string>
): Evaluation {
  const context: SeverityContext = {
    fleetId: input.fleetId,
    generation: input.generation,
    exceptions,
  }
  const tierFor = (
    record: ScanFaultRecord,
    prior: PttFaultSeverity
  ): PttFaultSeverity =>
    resolveSeverity(
      classifyFaultSeverity(
        {
          canonicalKey: record.canonicalKey,
          pttStatus: record.pttStatus,
          ecuLabel: record.ecuLabel,
          description: record.description,
        },
        context
      ),
      prior
    )

  const baselineRecords = baselineMerged.map(({ record }) => ({
    ...record,
    severity: tierFor(record, record.severity),
  }))
  const baselineByKey = new Map(
    baselineRecords.map((record) => [record.canonicalKey, record])
  )
  const verificationRecords = verificationMerged.map(({ record }) => ({
    ...record,
    severity: tierFor(
      record,
      baselineByKey.get(record.canonicalKey)?.severity ??
        input.ledger.get(record.canonicalKey)?.latestSeverity ??
        record.severity
    ),
  }))

  const result = reconcileDiagnosticScans({
    fleetId: input.fleetId,
    generation: input.generation,
    baselineFaults: baselineRecords,
    verificationFaults: verificationRecords,
    exceptions,
    bounceBackKeys,
  })
  return {
    baselineRecords,
    verificationRecords,
    result,
    isException: (key) =>
      matchesApprovedException(exceptions, input.fleetId, input.generation, key),
  }
}

const sameValues = (row: StoredFaultRow, values: ScanFaultValues) =>
  row.canonicalKey === values.canonicalKey &&
  row.pttStatus === values.pttStatus &&
  row.severity === values.severity &&
  row.description === values.description &&
  row.reconciliationBucket === values.reconciliationBucket &&
  row.isApprovedException === values.isApprovedException &&
  row.isBounceBack === values.isBounceBack &&
  row.keyNeedsReview === values.keyNeedsReview &&
  row.keyReviewReason === values.keyReviewReason

// A key may only be taken once its previous holder has moved on, otherwise the
// (scanId, canonicalKey) unique index would reject the statement.
function orderUpdates(
  updates: Array<{ id: number; from: string; values: ScanFaultValues }>,
  heldKeys: ReadonlySet<string>
): Array<{ id: number; values: ScanFaultValues }> {
  const held = new Set(heldKeys)
  const pending = [...updates]
  const ordered: Array<{ id: number; values: ScanFaultValues }> = []
  while (pending.length > 0) {
    const index = pending.findIndex(
      (update) =>
        update.from === update.values.canonicalKey ||
        !held.has(update.values.canonicalKey)
    )
    const [next] = pending.splice(index === -1 ? 0 : index, 1)
    held.delete(next.from)
    held.add(next.values.canonicalKey)
    ordered.push({ id: next.id, values: next.values })
  }
  return ordered
}

function planScanFaults(
  rows: readonly StoredFaultRow[],
  merged: readonly MergedRecord[],
  finalRecords: ReadonlyMap<string, ScanFaultRecord>,
  valuesFor: (record: ScanFaultRecord, isBounceBack: boolean) => ScanFaultValues
): ScanFaultPlan {
  const deleteIds: number[] = []
  const updates: Array<{ id: number; from: string; values: ScanFaultValues }> = []
  const inserts: NewScanFaultRow[] = []

  for (const entry of merged) {
    const record = finalRecords.get(entry.record.canonicalKey) ?? entry.record
    const values = valuesFor(record, entry.isBounceBack)
    for (const folded of entry.folded) {
      if (folded.id !== null) deleteIds.push(folded.id)
    }
    if (entry.survivor && entry.survivor.id !== null) {
      if (!sameValues(entry.survivor, values)) {
        updates.push({ id: entry.survivor.id, from: entry.survivor.canonicalKey, values })
      }
    } else {
      inserts.push({
        ...values,
        ecuLabel: record.ecuLabel,
        dtcRaw: record.dtcRaw,
        isExtracted: true,
      })
    }
  }

  return {
    deleteIds,
    updates: orderUpdates(
      updates,
      new Set(rows.filter((row) => row.id !== null).map((row) => row.canonicalKey))
    ),
    inserts,
  }
}

/** Plans the full retrospective reconciliation of one case. */
export function planReconcileExistingCase(
  input: ReconcileExistingInput
): ReconcileExistingPlan {
  const { verificationScannedAt, session } = input
  const baselineMerged = rekeyAndMerge(input.baselineRows, input.generation)
  // Synthetic "absent from the screenshots" rows are rebuilt from the diff.
  const extractedVerificationRows = input.verificationRows.filter(
    (row) => row.isExtracted
  )
  const syntheticIds = input.verificationRows
    .filter((row) => !row.isExtracted && row.id !== null)
    .map((row) => row.id as number)
  const verificationMerged = rekeyAndMerge(
    extractedVerificationRows,
    input.generation
  )

  const bounceBackKeys = new Set(
    verificationMerged
      .filter((entry) => entry.isBounceBack && entry.record.pttStatus === "ACTIVE")
      .map((entry) => entry.record.canonicalKey)
  )

  const full = evaluate(
    input,
    baselineMerged,
    verificationMerged,
    input.exceptions,
    bounceBackKeys
  )
  const result = full.result

  // A case closed with accepted residuals only goes back to a clean closure
  // when nothing blocks it even WITHOUT the exceptions its own closure added.
  const wasAcceptedResiduals = session.caseStatus === "CLOSED_ACCEPTED_RESIDUALS"
  const cleanResult = wasAcceptedResiduals
    ? evaluate(
        input,
        baselineMerged,
        verificationMerged,
        input.exceptions.filter((rule) => !rule.createdByClosure),
        bounceBackKeys
      ).result
    : result
  const isClean = cleanResult.caseStatus === "VERIFIED_CLOSED"

  // ---- Scan-fault writes ---------------------------------------------------
  const bucketByKey = new Map(
    result.faults.map((fault) => [fault.canonicalKey, fault.bucket])
  )
  const baselineFinal = new Map(
    full.baselineRecords.map((record) => [record.canonicalKey, record])
  )
  const verificationFinal = new Map(
    full.verificationRecords.map((record) => [record.canonicalKey, record])
  )

  const baseline = planScanFaults(
    input.baselineRows,
    baselineMerged,
    baselineFinal,
    (record, isBounceBack) => ({
      canonicalKey: record.canonicalKey,
      pttStatus: record.pttStatus,
      severity: record.severity,
      description: record.description,
      reconciliationBucket: null,
      isApprovedException: full.isException(record.canonicalKey),
      isBounceBack,
      keyNeedsReview: record.keyNeedsReview,
      keyReviewReason: record.keyReviewReason,
    })
  )

  const verification = planScanFaults(
    extractedVerificationRows,
    verificationMerged,
    verificationFinal,
    (record, isBounceBack) => ({
      canonicalKey: record.canonicalKey,
      pttStatus: record.pttStatus,
      severity: record.severity,
      description: record.description,
      reconciliationBucket: bucketByKey.get(record.canonicalKey) ?? null,
      isApprovedException: full.isException(record.canonicalKey),
      isBounceBack: record.pttStatus === "ACTIVE" && isBounceBack,
      keyNeedsReview: record.keyNeedsReview,
      keyReviewReason: record.keyReviewReason,
    })
  )
  verification.deleteIds.push(...syntheticIds)

  const extractedKeys = new Set(verificationFinal.keys())
  for (const fault of result.buckets.CLEARED) {
    if (extractedKeys.has(fault.canonicalKey)) continue
    verification.inserts.push({
      canonicalKey: fault.canonicalKey,
      ecuLabel: fault.ecuLabel,
      dtcRaw: fault.dtcRaw,
      description: fault.description,
      pttStatus: "INACTIVE",
      severity: fault.severity,
      reconciliationBucket: "CLEARED",
      isBounceBack: false,
      isApprovedException: fault.isApprovedException,
      isExtracted: false,
      keyNeedsReview: false,
      keyReviewReason: null,
    })
  }

  // ---- Repaired keys ---------------------------------------------------------
  const repairs = new Set<string>()
  for (const entry of [...baselineMerged, ...verificationMerged]) {
    for (const previous of entry.previousKeys) {
      if (previous !== entry.record.canonicalKey) repairs.add(previous)
    }
  }

  // ---- Ledger ------------------------------------------------------------------
  const toLedgerFault = (record: {
    canonicalKey: string
    ecuLabel: string
    description: string
    severity: PttFaultSeverity
  }): LedgerScanFault => ({
    canonicalKey: record.canonicalKey,
    ecuLabel: record.ecuLabel,
    description: record.description,
    severity: record.severity,
    isApprovedException: full.isException(record.canonicalKey),
  })
  const activeVerification = full.verificationRecords.filter(
    (record) => record.pttStatus === "ACTIVE"
  )
  const activeKeys = new Set(activeVerification.map((record) => record.canonicalKey))

  // A key this very verification cleared that is active again after the repair
  // was never really cleared: reopen it quietly instead of calling it a bounce-back.
  let ledger = new Map<string, LedgerEntry>(
    [...input.ledger].map(([key, entry]): [string, LedgerEntry] => [
      key,
      entry.ledgerStatus === "CLEARED" &&
      entry.clearedScanId === input.verificationScanId &&
      activeKeys.has(key)
        ? { ...entry, ledgerStatus: "OPEN", clearedScanId: null, clearedAt: null }
        : entry,
    ])
  )

  // Baseline keys the ledger has never seen (the repaired ones) start their
  // history at the baseline scan time.
  const missingBaseline = full.baselineRecords.filter(
    (record) => record.pttStatus === "ACTIVE" && !ledger.has(record.canonicalKey)
  )
  const upserts = new Map<string, LedgerEntry>()
  if (missingBaseline.length > 0) {
    const baselinePlan = planLedgerCommit({
      fleetId: input.fleetId,
      scanId: input.baselineScanId,
      now: input.baselineScannedAt,
      activeFaults: missingBaseline.map(toLedgerFault),
      existing: ledger,
    })
    for (const entry of baselinePlan.upserts) upserts.set(entry.canonicalKey, entry)
    ledger = applyUpserts(ledger, baselinePlan.upserts)
  }

  // Keys already CLEARED by this scan keep their original clearedAt.
  const clearedFaults = result.buckets.CLEARED.filter((fault) => {
    const existing = ledger.get(fault.canonicalKey)
    return !(
      existing?.ledgerStatus === "CLEARED" &&
      existing.clearedScanId === input.verificationScanId
    )
  }).map((fault) =>
    toLedgerFault({
      canonicalKey: fault.canonicalKey,
      ecuLabel: fault.ecuLabel,
      description: fault.description,
      severity: fault.severity,
    })
  )
  const verificationPlan = planLedgerCommit({
    fleetId: input.fleetId,
    scanId: input.verificationScanId,
    now: verificationScannedAt,
    activeFaults: activeVerification.map(toLedgerFault),
    clearedFaults,
    existing: ledger,
  })
  for (const entry of verificationPlan.upserts) {
    upserts.set(entry.canonicalKey, entry)
  }

  // Carry the history of a repaired legacy key over to its new key.
  for (const entry of [...baselineMerged, ...verificationMerged]) {
    for (const previous of entry.previousKeys) {
      if (previous === entry.record.canonicalKey) continue
      const old = input.ledger.get(previous)
      const target = upserts.get(entry.record.canonicalKey)
      if (old && target) {
        upserts.set(target.canonicalKey, mergeLedgerEntries(target, old))
      }
    }
  }

  // ---- Case status -------------------------------------------------------------
  const keepsAcceptedResiduals = wasAcceptedResiduals && !isClean
  const caseStatus: PttCaseStatus = keepsAcceptedResiduals
    ? "CLOSED_ACCEPTED_RESIDUALS"
    : result.caseStatus
  const cleanlyClosed = caseStatus === "VERIFIED_CLOSED"
  const closed = cleanlyClosed || keepsAcceptedResiduals

  const sessionPlan: SessionPlan = {
    caseStatus,
    reconciliationSummary: result.summary,
    workflowStatus: closed
      ? "VERIFIED_CLOSED"
      : session.workflowStatus === "VERIFIED_CLOSED"
        ? "IN_PROGRESS"
        : session.workflowStatus,
    // An existing `verifiedAt` is never overwritten; a first-time closure is
    // dated by the verification photos, not by the moment of the re-run.
    verifiedAt: closed ? (session.verifiedAt ?? verificationScannedAt) : null,
    ...(cleanlyClosed
      ? {
          closureMode: "CLEAN" as const,
          closureReasonCategory: null,
          closureNote: null,
          closedBy: session.closedBy,
          closedAt: session.closedAt ?? verificationScannedAt,
        }
      : keepsAcceptedResiduals
        ? {
            closureMode: session.closureMode,
            closureReasonCategory: session.closureReasonCategory,
            closureNote: session.closureNote,
            closedBy: session.closedBy,
            closedAt: session.closedAt,
          }
        : {
            closureMode: null,
            closureReasonCategory: null,
            closureNote: null,
            closedBy: null,
            closedAt: null,
          }),
  }

  return {
    baseline,
    verification,
    session: sessionPlan,
    verificationCounts: summarizePttFaults(activeVerification),
    ledgerUpserts: [...upserts.values()],
    orphanLedgerKeyCandidates: [...repairs],
    repairedKeysCount: repairs.size,
    upgradedToClean: cleanlyClosed && session.caseStatus !== "VERIFIED_CLOSED",
    result,
  }
}
