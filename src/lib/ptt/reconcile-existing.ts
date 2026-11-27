import "server-only"

import { and, eq, inArray, like, ne } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { db } from "@/db"
import {
  pttDiagnosticSessionsTable,
  pttScanFaultsTable,
  pttTruckFaultLedgerTable,
} from "@/db/schema"
import type { PttTruckGeneration } from "@/lib/ptt-diagnostics"
import {
  ledgerUpsertStatement,
  loadBaselineSnapshot,
  loadLedgerMap,
} from "./case-db"
import {
  PTT_CLOSED_CASE_STATUSES,
  type PttCaseStatus,
} from "./constants"
import {
  planReconcileExistingCase,
  type CaseSessionState,
  type PlanException,
  type ReconcileExistingPlan,
  type ScanFaultPlan,
  type StoredFaultRow,
} from "./reconcile-existing-plan"
import { inferGenerationFromRecords } from "./scan-faults"

// Retrospective re-reconciliation of stored cases (Drizzle side). The pure
// decisions live in `reconcile-existing-plan.ts`; this module loads what the
// planner needs and turns its plan into statements that run in ONE atomic
// `db.batch` (the neon-http driver has no interactive transactions, and a
// batch is executed as a single transaction by Neon).

type ScanFaultRow = typeof pttScanFaultsTable.$inferSelect

export type CaseReconciliationOutcome = {
  baselineId: number
  fleetId: string
  generation: PttTruckGeneration
  previousCaseStatus: PttCaseStatus
  caseStatus: PttCaseStatus
  upgradedToClean: boolean
  repairedKeysCount: number
}

export type PreparedCaseReconciliation = {
  statements: BatchItem<"pg">[]
  outcome: CaseReconciliationOutcome
}

export type PrepareReconciliationOptions = {
  /**
   * Exceptions about to be created in the same batch (not stored yet), so the
   * re-evaluation already sees them.
   */
  extraExceptions?: readonly PlanException[]
  /** Exception rows being deactivated in the same batch (used by Reopen). */
  withoutExceptionIds?: readonly number[]
  /**
   * The case state to plan from instead of the stored one: Close Job plans as
   * "already CLOSED_ACCEPTED_RESIDUALS", Reopen as "no longer closed".
   */
  sessionOverride?: Partial<CaseSessionState>
}

const toStoredRow = (row: ScanFaultRow): StoredFaultRow => ({
  id: row.id,
  canonicalKey: row.canonicalKey,
  ecuLabel: row.ecuLabel,
  dtcRaw: row.dtcRaw,
  description: row.description,
  pttStatus: row.pttStatus,
  severity: row.severity,
  reconciliationBucket: row.reconciliationBucket,
  isBounceBack: row.isBounceBack,
  isApprovedException: row.isApprovedException,
  isExtracted: row.isExtracted,
  keyNeedsReview: row.keyNeedsReview,
  keyReviewReason: row.keyReviewReason,
})

function scanFaultStatements(
  scanId: number,
  plan: ScanFaultPlan
): BatchItem<"pg">[] {
  const statements: BatchItem<"pg">[] = []
  if (plan.deleteIds.length > 0) {
    statements.push(
      db
        .delete(pttScanFaultsTable)
        .where(inArray(pttScanFaultsTable.id, plan.deleteIds))
    )
  }
  for (const update of plan.updates) {
    statements.push(
      db
        .update(pttScanFaultsTable)
        .set(update.values)
        .where(eq(pttScanFaultsTable.id, update.id))
    )
  }
  if (plan.inserts.length > 0) {
    statements.push(
      db
        .insert(pttScanFaultsTable)
        .values(plan.inserts.map((insert) => ({ ...insert, scanId })))
    )
  }
  return statements
}

/**
 * Loads one case and builds every statement needed to re-reconcile it, without
 * running them. Returns `null` for a case that cannot be re-reconciled (not a
 * baseline, or no verification scan yet). `baselineId` is the case's baseline.
 */
export async function prepareCaseReconciliation(
  baselineId: number,
  options: PrepareReconciliationOptions = {}
): Promise<PreparedCaseReconciliation | null> {
  const baseline = await db.query.pttDiagnosticSessionsTable.findFirst({
    where: { id: baselineId },
    with: {
      faults: true,
      verificationScans: {
        with: { scanFaults: true },
        orderBy: { id: "desc" },
        limit: 1,
      },
    },
  })
  if (!baseline || baseline.scanRole !== "BASELINE") return null
  const verification = baseline.verificationScans[0]
  if (!verification) return null

  const snapshot = await loadBaselineSnapshot(baseline)
  const generation: PttTruckGeneration =
    baseline.truckGeneration === "UNKNOWN"
      ? inferGenerationFromRecords(snapshot.records)
      : baseline.truckGeneration

  const baselineRows: StoredFaultRow[] = snapshot.needsBackfill
    ? snapshot.records.map((record) => ({
        id: null,
        canonicalKey: record.canonicalKey,
        ecuLabel: record.ecuLabel,
        dtcRaw: record.dtcRaw,
        description: record.description,
        pttStatus: record.pttStatus,
        severity: record.severity,
        reconciliationBucket: null,
        isBounceBack: false,
        isApprovedException: false,
        isExtracted: true,
        keyNeedsReview: record.keyNeedsReview,
        keyReviewReason: record.keyReviewReason,
      }))
    : (
        await db.query.pttScanFaultsTable.findMany({
          where: { scanId: baseline.id },
          orderBy: { id: "asc" },
        })
      ).map(toStoredRow)

  const exceptionRows = await db.query.pttApprovedExceptionsTable.findMany({
    where: {
      isActive: true,
      OR:
        generation === "UNKNOWN"
          ? [{ scope: "TRUCK_SPECIFIC", fleetId: baseline.fleetId }]
          : [
              { scope: "FLEET_GENERATION", generation },
              { scope: "TRUCK_SPECIFIC", fleetId: baseline.fleetId },
            ],
    },
  })
  const skipped = new Set(options.withoutExceptionIds ?? [])
  const sessionState: CaseSessionState = {
    caseStatus: baseline.caseStatus,
    workflowStatus: baseline.status,
    verifiedAt: baseline.verifiedAt,
    closureMode: baseline.closureMode,
    closureReasonCategory: baseline.closureReasonCategory,
    closureNote: baseline.closureNote,
    closedBy: baseline.closedBy,
    closedAt: baseline.closedAt,
    ...options.sessionOverride,
  }
  const closedAt = sessionState.closedAt
  const exceptions: PlanException[] = [
    ...exceptionRows
      .filter((row) => !skipped.has(row.id))
      .map((row) => ({
        scope: row.scope,
        generation: row.generation,
        fleetId: row.fleetId,
        canonicalKey: row.canonicalKey,
        isActive: row.isActive,
        // A manager made it while closing this very case (see
        // `closeCaseWithAcceptedResidualsAction`).
        createdByClosure:
          sessionState.caseStatus === "CLOSED_ACCEPTED_RESIDUALS" &&
          closedAt !== null &&
          row.approvedBy === sessionState.closedBy &&
          row.approvedAt.getTime() === closedAt.getTime(),
      })),
    ...(options.extraExceptions ?? []),
  ]

  const ledger = await loadLedgerMap(baseline.fleetId)
  const now = new Date()
  const plan: ReconcileExistingPlan = planReconcileExistingCase({
    fleetId: baseline.fleetId,
    generation,
    baselineScanId: baseline.id,
    baselineScannedAt: baseline.scannedAt,
    verificationScanId: verification.id,
    baselineRows,
    verificationRows: verification.scanFaults.map(toStoredRow),
    exceptions,
    ledger,
    session: sessionState,
    now,
  })

  const statements: BatchItem<"pg">[] = [
    ...scanFaultStatements(baseline.id, plan.baseline),
    ...scanFaultStatements(verification.id, plan.verification),
  ]

  const upsert = ledgerUpsertStatement(plan.ledgerUpserts)
  if (upsert) statements.push(upsert)

  // Orphaned legacy ledger rows: repaired keys that no other case still uses.
  const finalKeys = new Set(plan.ledgerUpserts.map((entry) => entry.canonicalKey))
  const candidates = plan.orphanLedgerKeyCandidates.filter(
    (key) => !finalKeys.has(key)
  )
  if (candidates.length > 0) {
    const stillUsed = await db
      .select({ key: pttScanFaultsTable.canonicalKey })
      .from(pttScanFaultsTable)
      .innerJoin(
        pttDiagnosticSessionsTable,
        eq(pttScanFaultsTable.scanId, pttDiagnosticSessionsTable.id)
      )
      .where(
        and(
          inArray(pttScanFaultsTable.canonicalKey, candidates),
          eq(pttDiagnosticSessionsTable.fleetId, baseline.fleetId),
          ne(pttDiagnosticSessionsTable.caseId, baseline.caseId)
        )
      )
    const used = new Set(stillUsed.map((row) => row.key))
    const orphans = candidates.filter((key) => !used.has(key))
    if (orphans.length > 0) {
      statements.push(
        db
          .delete(pttTruckFaultLedgerTable)
          .where(
            and(
              eq(pttTruckFaultLedgerTable.fleetId, baseline.fleetId),
              inArray(pttTruckFaultLedgerTable.canonicalKey, orphans)
            )
          )
      )
    }
  }

  const { session, verificationCounts } = plan
  statements.push(
    db
      .update(pttDiagnosticSessionsTable)
      .set({
        caseStatus: session.caseStatus,
        reconciliationSummary: session.reconciliationSummary,
        overallSeverity: verificationCounts.overallSeverity,
        criticalCount: verificationCounts.criticalCount,
        calibrationCount: verificationCounts.calibrationCount,
        monitorCount: verificationCounts.monitorCount,
        negligibleCount: verificationCounts.negligibleCount,
        updatedAt: now,
      })
      .where(eq(pttDiagnosticSessionsTable.id, verification.id)),
    db
      .update(pttDiagnosticSessionsTable)
      .set({
        caseStatus: session.caseStatus,
        reconciliationSummary: session.reconciliationSummary,
        status: session.workflowStatus,
        verifiedAt: session.verifiedAt,
        closureMode: session.closureMode,
        closureReasonCategory: session.closureReasonCategory,
        closureNote: session.closureNote,
        closedBy: session.closedBy,
        closedAt: session.closedAt,
        updatedAt: now,
      })
      .where(eq(pttDiagnosticSessionsTable.id, baseline.id))
  )

  return {
    statements,
    outcome: {
      baselineId: baseline.id,
      fleetId: baseline.fleetId,
      generation,
      previousCaseStatus: baseline.caseStatus,
      caseStatus: session.caseStatus,
      upgradedToClean: plan.upgradedToClean,
      repairedKeysCount: plan.repairedKeysCount,
    },
  }
}

/**
 * Re-reconciles one stored case: re-normalises every row of the baseline and
 * the latest verification scan, re-applies severity, re-runs the diff and
 * persists buckets, case status, closure state and the truck ledger in one
 * atomic batch. Returns `null` when the case has no verification scan.
 */
export async function reconcileExistingCase(
  sessionId: number,
  options: PrepareReconciliationOptions = {}
): Promise<CaseReconciliationOutcome | null> {
  const prepared = await prepareCaseReconciliation(
    await resolveBaselineId(sessionId),
    options
  )
  if (!prepared) return null
  const [first, ...rest] = prepared.statements
  await db.batch([first, ...rest])
  return prepared.outcome
}

/** Accepts a baseline id or a verification-scan id and returns the baseline id. */
async function resolveBaselineId(sessionId: number): Promise<number> {
  const session = await db.query.pttDiagnosticSessionsTable.findFirst({
    where: { id: sessionId },
    columns: { id: true, parentScanId: true },
  })
  return session?.parentScanId ?? sessionId
}

export type CascadeSummary = {
  processedCount: number
  closedCount: number
  repairedKeysCount: number
}

/**
 * After a FLEET_GENERATION exception was approved: re-reconciles every OTHER
 * non-closed case of that generation that has a verification scan, since the
 * new exception may clear their blockers too. A failing case is logged and
 * skipped so one bad row never blocks the rest.
 */
export async function cascadeGenerationReconcile(
  generation: PttTruckGeneration,
  excludeBaselineId: number
): Promise<CascadeSummary> {
  const candidates = await db.query.pttDiagnosticSessionsTable.findMany({
    where: { scanRole: "BASELINE", truckGeneration: generation },
    columns: { id: true, caseStatus: true },
    with: {
      verificationScans: { columns: { id: true }, limit: 1 },
    },
  })
  const targets = candidates.filter(
    (session) =>
      session.id !== excludeBaselineId &&
      !PTT_CLOSED_CASE_STATUSES.includes(session.caseStatus) &&
      session.verificationScans.length > 0
  )

  const summary: CascadeSummary = {
    processedCount: 0,
    closedCount: 0,
    repairedKeysCount: 0,
  }
  for (const target of targets) {
    try {
      const outcome = await reconcileExistingCase(target.id)
      if (!outcome) continue
      summary.processedCount += 1
      summary.repairedKeysCount += outcome.repairedKeysCount
      if (outcome.upgradedToClean) summary.closedCount += 1
    } catch (error) {
      console.error(
        `[ptt-reconcile] cascade failed for case ${target.id} (skipped):`,
        error
      )
    }
  }
  return summary
}

export type ReconcileAllSummary = CascadeSummary & {
  failedCount: number
}

const OPEN_CASE_STATUSES: readonly PttCaseStatus[] = [
  "OPEN",
  "PARTIAL_BLOCKED",
  "REJECTED_NO_PROGRESS",
  "REJECTED_INCOMPLETE",
]

/**
 * Every case that still needs the retrospective repair: has a verification
 * scan and is not closed, or (closed or not) still carries `UNVERIFIED|...`
 * keys. Cases closed with accepted residuals are only included for the keys.
 */
export async function reconcileAllOpenVerifiedCases(): Promise<ReconcileAllSummary> {
  const unverifiedScanFaults = await db
    .select({
      scanId: pttScanFaultsTable.scanId,
      parentScanId: pttDiagnosticSessionsTable.parentScanId,
    })
    .from(pttScanFaultsTable)
    .innerJoin(
      pttDiagnosticSessionsTable,
      eq(pttScanFaultsTable.scanId, pttDiagnosticSessionsTable.id)
    )
    .where(like(pttScanFaultsTable.canonicalKey, "UNVERIFIED|%"))
  const withUnverified = new Set(
    unverifiedScanFaults.map((row) => row.parentScanId ?? row.scanId)
  )

  const baselines = await db.query.pttDiagnosticSessionsTable.findMany({
    where: { scanRole: "BASELINE" },
    columns: { id: true, caseStatus: true },
    with: { verificationScans: { columns: { id: true }, limit: 1 } },
    orderBy: { id: "asc" },
  })
  const targets = baselines.filter(
    (session) =>
      session.verificationScans.length > 0 &&
      (OPEN_CASE_STATUSES.includes(session.caseStatus) ||
        withUnverified.has(session.id))
  )

  const summary: ReconcileAllSummary = {
    processedCount: 0,
    closedCount: 0,
    repairedKeysCount: 0,
    failedCount: 0,
  }
  for (const target of targets) {
    try {
      const outcome = await reconcileExistingCase(target.id)
      if (!outcome) continue
      summary.processedCount += 1
      summary.repairedKeysCount += outcome.repairedKeysCount
      if (outcome.upgradedToClean) summary.closedCount += 1
    } catch (error) {
      summary.failedCount += 1
      console.error(
        `[ptt-reconcile] re-reconcile failed for case ${target.id} (skipped):`,
        error
      )
    }
  }
  return summary
}
