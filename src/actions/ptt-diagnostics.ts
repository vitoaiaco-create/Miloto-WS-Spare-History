"use server"

import { del } from "@vercel/blob"
import { eq, inArray } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import {
  pttApprovedExceptionsTable,
  pttDiagnosticSessionsTable,
  pttSessionAttachmentsTable,
} from "@/db/schema"
import { requireAdmin } from "@/lib/hr-admin-auth"
import {
  PTT_SESSION_STATUSES,
  type PttSessionStatus,
  type PttTruckGeneration,
} from "@/lib/ptt-diagnostics"
import {
  ledgerUpsertStatement,
  loadApplicableExceptions,
  loadBaselineSnapshot,
  loadLedgerMap,
  recordFromScanFaultRow,
} from "@/lib/ptt/case-db"
import {
  MANUAL_CLOSE_BLOCKED_MESSAGE,
  canSetWorkflowVerifiedClosed,
} from "@/lib/ptt/closure-guard"
import {
  collectClosureResiduals,
  countActionableBaselineFaults,
  evaluateClosureEligibility,
  planClosureLedgerUpserts,
} from "@/lib/ptt/closure-rules"
import {
  PTT_CLOSURE_NOTE_MIN_LENGTH,
  PTT_CLOSURE_REASON_CATEGORIES,
  PTT_EXCEPTION_REASON_CATEGORIES,
  PTT_EXCEPTION_SCOPES,
  type PttExceptionScope,
} from "@/lib/ptt/constants"
import { matchesApprovedException } from "@/lib/ptt/reconcile"
import {
  cascadeGenerationReconcile,
  prepareCaseReconciliation,
  reconcileAllOpenVerifiedCases,
  reconcileExistingCase,
} from "@/lib/ptt/reconcile-existing"
import type { PlanException } from "@/lib/ptt/reconcile-existing-plan"
import { inferGenerationFromRecords, rekeyScanFaultRecord } from "@/lib/ptt/scan-faults"
import {
  querySessionDetail,
  type PttSessionDetail,
} from "@/lib/ptt/session-query"

// Every action resolves to a plain `{ success, ... }` object. Raw Error
// instances must never cross the Server -> Client boundary.
export type PttActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export type { PttSessionDetail }

const DIAGNOSTICS_PATH = "/diagnostics"

const sessionIdSchema = z
  .number({ error: "Invalid session id" })
  .int({ error: "Invalid session id" })
  .positive({ error: "Invalid session id" })
const statusSchema = z.enum(PTT_SESSION_STATUSES)

function toErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Invalid input"
  }
  return error instanceof Error ? error.message : "Unknown error"
}

// Status can move freely forward or backward, except into VERIFIED_CLOSED:
// that needs a passing verification scan (see `canSetWorkflowVerifiedClosed`).
// `verifiedAt` is stamped on entering VERIFIED_CLOSED and cleared on leaving it.
export async function updatePttSessionStatus(
  sessionId: number,
  status: PttSessionStatus
): Promise<PttActionResult<{ id: number; status: PttSessionStatus }>> {
  try {
    await requireAdmin()
    const id = sessionIdSchema.parse(sessionId)
    const nextStatus = statusSchema.parse(status)

    // Closing is only possible through a passing verification scan: check the
    // stored case verdict server-side (the dropdown's disabled option is a
    // convenience, not the guard).
    if (nextStatus === "VERIFIED_CLOSED") {
      const current = await db.query.pttDiagnosticSessionsTable.findFirst({
        where: { id },
        columns: { caseStatus: true },
        with: {
          verificationScans: {
            columns: { caseStatus: true },
            orderBy: { id: "desc" },
            limit: 1,
          },
        },
      })
      if (!current) throw new Error("Session not found")
      if (
        !canSetWorkflowVerifiedClosed({
          caseStatus: current.caseStatus,
          latestVerificationCaseStatus:
            current.verificationScans[0]?.caseStatus ?? null,
        })
      ) {
        throw new Error(MANUAL_CLOSE_BLOCKED_MESSAGE)
      }
    }

    const now = new Date()
    const [row] = await db
      .update(pttDiagnosticSessionsTable)
      .set({
        status: nextStatus,
        verifiedAt: nextStatus === "VERIFIED_CLOSED" ? now : null,
        updatedAt: now,
      })
      .where(eq(pttDiagnosticSessionsTable.id, id))
      .returning({
        id: pttDiagnosticSessionsTable.id,
        status: pttDiagnosticSessionsTable.status,
      })
    if (!row) throw new Error("Session not found")

    revalidatePath(DIAGNOSTICS_PATH)
    return { success: true, data: row }
  } catch (error) {
    console.error("[ptt-diagnostics] updatePttSessionStatus failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}

export async function deletePttSession(
  sessionId: number
): Promise<PttActionResult<{ id: number }>> {
  try {
    await requireAdmin()
    const id = sessionIdSchema.parse(sessionId)

    // Fault and attachment rows cascade away with the session, but the Blob
    // objects do not — remove them first. If this throws, the session is left
    // intact so the delete can simply be retried.
    // Verification scans (children of a baseline) go with it, so their
    // screenshots are removed too.
    const children = await db
      .select({ id: pttDiagnosticSessionsTable.id })
      .from(pttDiagnosticSessionsTable)
      .where(eq(pttDiagnosticSessionsTable.parentScanId, id))
    const attachments = await db
      .select({ blobUrl: pttSessionAttachmentsTable.blobUrl })
      .from(pttSessionAttachmentsTable)
      .where(
        inArray(pttSessionAttachmentsTable.sessionId, [
          id,
          ...children.map((child) => child.id),
        ])
      )
    if (attachments.length > 0) {
      await del(attachments.map((a) => a.blobUrl))
    }

    const [row] = await db
      .delete(pttDiagnosticSessionsTable)
      .where(eq(pttDiagnosticSessionsTable.id, id))
      .returning({ id: pttDiagnosticSessionsTable.id })
    if (!row) throw new Error("Session not found")

    revalidatePath(DIAGNOSTICS_PATH)
    return { success: true, data: row }
  } catch (error) {
    console.error("[ptt-diagnostics] deletePttSession failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}

export async function getPttSessionById(
  sessionId: number
): Promise<PttActionResult<PttSessionDetail>> {
  try {
    await requireAdmin()
    const id = sessionIdSchema.parse(sessionId)

    const session = await querySessionDetail(id)
    if (!session) throw new Error("Session not found")

    return { success: true, data: session }
  } catch (error) {
    console.error("[ptt-diagnostics] getPttSessionById failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** A single `db.batch` needs a non-empty tuple. */
async function runBatch(statements: BatchItem<"pg">[]) {
  const [first, ...rest] = statements
  if (!first) return
  await db.batch([first, ...rest])
}

const canonicalKeySchema = z
  .string({ error: "Fault key is required" })
  .trim()
  .min(1, { error: "Fault key is required" })
  .max(200)

type ExceptionScopeTarget = {
  scope: PttExceptionScope
  generation: PttTruckGeneration
  fleetId: string
}

/** The exception row (`ptt_approved_exceptions` insert) for one key. */
function exceptionRow(
  target: ExceptionScopeTarget,
  canonicalKey: string,
  reasonCategory: string,
  physicalProofNote: string,
  approvedBy: string,
  approvedAt?: Date
): typeof pttApprovedExceptionsTable.$inferInsert {
  const fleetWide = target.scope === "FLEET_GENERATION"
  if (fleetWide && target.generation === "UNKNOWN") {
    throw new Error(
      "This truck's generation is unknown, so a fleet-wide exception cannot be created. Use a truck-specific exception."
    )
  }
  return {
    scope: target.scope,
    generation:
      fleetWide && target.generation !== "UNKNOWN" ? target.generation : null,
    fleetId: fleetWide ? null : target.fleetId,
    canonicalKey,
    reasonCategory,
    physicalProofNote,
    approvedBy,
    ...(approvedAt ? { approvedAt } : {}),
  }
}

const planException = (
  row: typeof pttApprovedExceptionsTable.$inferInsert,
  createdByClosure = false
): PlanException => ({
  scope: row.scope,
  generation: row.generation ?? null,
  fleetId: row.fleetId ?? null,
  canonicalKey: row.canonicalKey,
  isActive: true,
  createdByClosure,
})

// ---------------------------------------------------------------------------
// Approved exceptions
// ---------------------------------------------------------------------------

const exceptionDetailsSchema = {
  scope: z.enum(PTT_EXCEPTION_SCOPES),
  reasonCategory: z.enum(PTT_EXCEPTION_REASON_CATEGORIES, {
    error: "Choose a reason category",
  }),
  physicalProofNote: z
    .string({ error: "A physical proof note is required" })
    .trim()
    .min(10, {
      error: "Describe the physical proof (at least 10 characters)",
    })
    .max(2000),
}

const approveExceptionSchema = z.object({
  // The case's baseline scan id (the session shown in the case view).
  sessionId: sessionIdSchema,
  canonicalKey: canonicalKeySchema,
  ...exceptionDetailsSchema,
})

export type ApprovePttExceptionInput = z.infer<typeof approveExceptionSchema>

const approveExceptionsBatchSchema = z.object({
  sessionId: sessionIdSchema,
  canonicalKeys: z
    .array(canonicalKeySchema, { error: "Select at least one fault" })
    .min(1, { error: "Select at least one fault" })
    .max(200),
  ...exceptionDetailsSchema,
})

export type ApprovePttExceptionsBatchInput = z.infer<
  typeof approveExceptionsBatchSchema
>

export type PttExceptionApprovalResult = {
  session: PttSessionDetail
  approvedCount: number
  /** Other cases (same generation) that this fleet-wide exception closed. */
  cascadedClosedCount: number
  /** Other cases that were re-reconciled by the cascade. */
  cascadedProcessedCount: number
}

/**
 * Approves exceptions for faults that are still open (or newly appeared) on the
 * case's latest verification scan, then re-evaluates the case: the new
 * exception rows, buckets, severities, the equation counts, the case status and
 * the truck ledger are all written in ONE atomic batch. A fleet-wide approval
 * then cascades over the other open cases of that generation.
 */
async function approveExceptionsForCase(input: {
  userId: string
  sessionId: number
  canonicalKeys: readonly string[]
  scope: PttExceptionScope
  reasonCategory: string
  physicalProofNote: string
}): Promise<PttExceptionApprovalResult> {
  const baseline = await db.query.pttDiagnosticSessionsTable.findFirst({
    where: { id: input.sessionId },
    with: {
      faults: true,
      verificationScans: {
        with: { scanFaults: true },
        orderBy: { id: "desc" },
        limit: 1,
      },
    },
  })
  if (!baseline || baseline.scanRole !== "BASELINE") {
    throw new Error("Case not found")
  }
  const latest = baseline.verificationScans[0]
  if (!latest) {
    throw new Error("This case has no verification scan to re-evaluate yet")
  }

  const generation: PttTruckGeneration =
    baseline.truckGeneration === "UNKNOWN"
      ? inferGenerationFromRecords(
          (await loadBaselineSnapshot(baseline)).records
        )
      : baseline.truckGeneration

  // Each requested key must be an open fault on the latest verification scan.
  // It is saved under its repaired canonical key (an OCR-garbled
  // `UNVERIFIED|...` row is re-normalised first), so the exception matches the
  // key the re-reconciliation will assign.
  const effectiveKeys = new Set<string>()
  for (const requested of new Set(input.canonicalKeys)) {
    const target = latest.scanFaults.find(
      (fault) => fault.canonicalKey === requested
    )
    if (
      !target ||
      (target.reconciliationBucket !== "PERSISTING_OPEN" &&
        target.reconciliationBucket !== "NEW_REGRESSION")
    ) {
      throw new Error(
        "That fault is not an open fault on the latest verification scan"
      )
    }
    effectiveKeys.add(
      rekeyScanFaultRecord(recordFromScanFaultRow(target), generation)
        .canonicalKey
    )
  }

  const target: ExceptionScopeTarget = {
    scope: input.scope,
    generation,
    fleetId: baseline.fleetId,
  }
  const rows = [...effectiveKeys].map((key) =>
    exceptionRow(
      target,
      key,
      input.reasonCategory,
      input.physicalProofNote,
      input.userId
    )
  )

  const prepared = await prepareCaseReconciliation(baseline.id, {
    extraExceptions: rows.map((row) => planException(row)),
  })
  if (!prepared) throw new Error("Case not found")

  await runBatch([
    db
      .insert(pttApprovedExceptionsTable)
      .values(rows)
      // Already covered by an identical active rule: nothing to add.
      .onConflictDoNothing(),
    ...prepared.statements,
  ])

  let cascadedClosedCount = 0
  let cascadedProcessedCount = 0
  if (input.scope === "FLEET_GENERATION") {
    const cascade = await cascadeGenerationReconcile(generation, baseline.id)
    cascadedClosedCount = cascade.closedCount
    cascadedProcessedCount = cascade.processedCount
  }

  const session = await querySessionDetail(baseline.id)
  if (!session) throw new Error("Case not found")
  revalidatePath(DIAGNOSTICS_PATH)
  return {
    session,
    approvedCount: rows.length,
    cascadedClosedCount,
    cascadedProcessedCount,
  }
}

export async function approvePttException(
  input: ApprovePttExceptionInput
): Promise<PttActionResult<PttExceptionApprovalResult>> {
  try {
    const userId = await requireAdmin()
    const data = approveExceptionSchema.parse(input)
    const result = await approveExceptionsForCase({
      userId,
      sessionId: data.sessionId,
      canonicalKeys: [data.canonicalKey],
      scope: data.scope,
      reasonCategory: data.reasonCategory,
      physicalProofNote: data.physicalProofNote,
    })
    return { success: true, data: result }
  } catch (error) {
    console.error("[ptt-diagnostics] approvePttException failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}

/** "Batch Approve Remaining": one shared reason / proof note for many faults. */
export async function approvePttExceptionsBatch(
  input: ApprovePttExceptionsBatchInput
): Promise<PttActionResult<PttExceptionApprovalResult>> {
  try {
    const userId = await requireAdmin()
    const data = approveExceptionsBatchSchema.parse(input)
    const result = await approveExceptionsForCase({
      userId,
      sessionId: data.sessionId,
      canonicalKeys: data.canonicalKeys,
      scope: data.scope,
      reasonCategory: data.reasonCategory,
      physicalProofNote: data.physicalProofNote,
    })
    return { success: true, data: result }
  } catch (error) {
    console.error("[ptt-diagnostics] approvePttExceptionsBatch failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}

// ---------------------------------------------------------------------------
// Retrospective re-reconciliation
// ---------------------------------------------------------------------------

export type PttReconcileCaseResult = {
  session: PttSessionDetail
  upgradedToClean: boolean
  repairedKeysCount: number
}

/** "Re-run Reconciliation" on one case (baseline id, or its verification id). */
export async function reconcileCaseAction(
  sessionId: number
): Promise<PttActionResult<PttReconcileCaseResult>> {
  try {
    await requireAdmin()
    const id = sessionIdSchema.parse(sessionId)
    const outcome = await reconcileExistingCase(id)
    if (!outcome) {
      throw new Error("This case has no verification scan to reconcile yet")
    }
    const session = await querySessionDetail(outcome.baselineId)
    if (!session) throw new Error("Case not found")
    revalidatePath(DIAGNOSTICS_PATH)
    return {
      success: true,
      data: {
        session,
        upgradedToClean: outcome.upgradedToClean,
        repairedKeysCount: outcome.repairedKeysCount,
      },
    }
  } catch (error) {
    console.error("[ptt-diagnostics] reconcileCaseAction failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}

export type PttReconcileAllResult = {
  processedCount: number
  upgradedToClosedCount: number
  repairedKeysCount: number
  failedCount: number
}

/** Toolbar "Re-reconcile After-Scans": every open case with a verification scan. */
export async function reconcileAllOpenVerifiedCasesAction(): Promise<
  PttActionResult<PttReconcileAllResult>
> {
  try {
    await requireAdmin()
    const summary = await reconcileAllOpenVerifiedCases()
    revalidatePath(DIAGNOSTICS_PATH)
    return {
      success: true,
      data: {
        processedCount: summary.processedCount,
        upgradedToClosedCount: summary.closedCount,
        repairedKeysCount: summary.repairedKeysCount,
        failedCount: summary.failedCount,
      },
    }
  } catch (error) {
    console.error(
      "[ptt-diagnostics] reconcileAllOpenVerifiedCasesAction failed:",
      error
    )
    return { success: false, error: toErrorMessage(error) }
  }
}

// ---------------------------------------------------------------------------
// Controlled closure: Close Job (Accept Residual Faults)
// ---------------------------------------------------------------------------

const closeCaseSchema = z.object({
  // The case's baseline scan id.
  sessionId: sessionIdSchema,
  closureReasonCategory: z.enum(PTT_CLOSURE_REASON_CATEGORIES, {
    error: "Choose a closure reason",
  }),
  closureNote: z
    .string({ error: "A closure note is required" })
    .trim()
    .min(PTT_CLOSURE_NOTE_MIN_LENGTH, {
      error: `Describe why the job is being closed (at least ${PTT_CLOSURE_NOTE_MIN_LENGTH} characters)`,
    })
    .max(2000),
  saveResidualsAsExceptions: z.boolean().default(true),
  exceptionScope: z.enum(PTT_EXCEPTION_SCOPES).default("TRUCK_SPECIFIC"),
})

// `z.input`: the two defaulted fields may be omitted by the caller.
export type CloseCaseWithAcceptedResidualsInput = z.input<typeof closeCaseSchema>

export type PttCloseCaseResult = {
  session: PttSessionDetail
  residualCount: number
  savedAsExceptions: boolean
  cascadedClosedCount: number
}

/**
 * Manager release: closes a case while known residual faults remain.
 *
 * Eligibility (see `evaluateClosureEligibility`): a saved verification scan that
 * is PARTIAL_BLOCKED / REJECTED_NO_PROGRESS, or a baseline-only case with no
 * actionable Critical / Calibration fault. Everything is written in ONE atomic
 * batch: the residual exceptions (when `saveResidualsAsExceptions`), the
 * re-reconciliation and the closure audit fields (`closedBy` / `closedAt`).
 * With `saveResidualsAsExceptions` false nothing is exempted: the faults stay
 * OPEN in the ledger and keep showing as outstanding in the reports.
 */
export async function closeCaseWithAcceptedResidualsAction(
  input: CloseCaseWithAcceptedResidualsInput
): Promise<PttActionResult<PttCloseCaseResult>> {
  try {
    const userId = await requireAdmin()
    const data = closeCaseSchema.parse(input)

    const baseline = await db.query.pttDiagnosticSessionsTable.findFirst({
      where: { id: data.sessionId },
      with: {
        faults: true,
        verificationScans: {
          with: { scanFaults: true },
          orderBy: { id: "desc" },
          limit: 1,
        },
      },
    })
    if (!baseline || baseline.scanRole !== "BASELINE") {
      throw new Error("Case not found")
    }
    const latest = baseline.verificationScans[0] ?? null

    const snapshot = await loadBaselineSnapshot(baseline)
    const generation: PttTruckGeneration =
      baseline.truckGeneration === "UNKNOWN"
        ? inferGenerationFromRecords(snapshot.records)
        : baseline.truckGeneration
    const rules = await loadApplicableExceptions(baseline.fleetId, generation)
    const baselineFaults = snapshot.records.map((record) => ({
      ...record,
      isApprovedException: matchesApprovedException(
        rules,
        baseline.fleetId,
        generation,
        record.canonicalKey
      ),
    }))

    const eligibility = evaluateClosureEligibility({
      caseStatus: baseline.caseStatus,
      hasVerificationScan: latest !== null,
      baselineActionableCount: countActionableBaselineFaults(baselineFaults),
    })
    if (!eligibility.allowed) throw new Error(eligibility.reason)

    const now = new Date()
    const closure = {
      caseStatus: "CLOSED_ACCEPTED_RESIDUALS" as const,
      workflowStatus: "VERIFIED_CLOSED" as const,
      verifiedAt: now,
      closureMode: "ACCEPTED_RESIDUALS" as const,
      closureReasonCategory: data.closureReasonCategory,
      closureNote: data.closureNote,
      closedBy: userId,
      closedAt: now,
    }

    // The residuals being accepted, under their repaired canonical keys.
    const residuals = collectClosureResiduals(
      latest
        ? {
            reconciled: latest.scanFaults
              .filter((row) => row.isExtracted)
              .map((row) => ({
                ...rekeyScanFaultRecord(recordFromScanFaultRow(row), generation),
                bucket: row.reconciliationBucket ?? ("CLEARED" as const),
              })),
            baseline: [],
          }
        : { reconciled: null, baseline: baselineFaults }
    )

    const target: ExceptionScopeTarget = {
      scope: data.exceptionScope,
      generation,
      fleetId: baseline.fleetId,
    }
    // `approvedAt === closedAt` + `approvedBy === closedBy` tags these rows as
    // created by this closure (see `prepareCaseReconciliation`).
    const rows =
      data.saveResidualsAsExceptions && residuals.length > 0
        ? residuals.map((residual) =>
            exceptionRow(
              target,
              residual.canonicalKey,
              data.closureReasonCategory,
              data.closureNote,
              userId,
              now
            )
          )
        : []

    const statements: BatchItem<"pg">[] = []
    if (rows.length > 0) {
      statements.push(
        db
          .insert(pttApprovedExceptionsTable)
          .values(rows)
          .onConflictDoNothing()
      )
    }

    if (latest) {
      const prepared = await prepareCaseReconciliation(baseline.id, {
        extraExceptions: rows.map((row) => planException(row, true)),
        sessionOverride: closure,
      })
      if (!prepared) throw new Error("Case not found")
      statements.push(...prepared.statements)
    } else {
      const ledger = await loadLedgerMap(baseline.fleetId)
      const ledgerStatement = ledgerUpsertStatement(
        planClosureLedgerUpserts({
          residualKeys: residuals.map((residual) => residual.canonicalKey),
          saveResidualsAsExceptions: rows.length > 0,
          ledger,
        })
      )
      if (ledgerStatement) statements.push(ledgerStatement)
      statements.push(
        db
          .update(pttDiagnosticSessionsTable)
          .set({
            caseStatus: closure.caseStatus,
            status: closure.workflowStatus,
            verifiedAt: closure.verifiedAt,
            closureMode: closure.closureMode,
            closureReasonCategory: closure.closureReasonCategory,
            closureNote: closure.closureNote,
            closedBy: closure.closedBy,
            closedAt: closure.closedAt,
            updatedAt: now,
          })
          .where(eq(pttDiagnosticSessionsTable.id, baseline.id))
      )
    }
    await runBatch(statements)

    let cascadedClosedCount = 0
    if (rows.length > 0 && data.exceptionScope === "FLEET_GENERATION") {
      cascadedClosedCount = (
        await cascadeGenerationReconcile(generation, baseline.id)
      ).closedCount
    }

    const session = await querySessionDetail(baseline.id)
    if (!session) throw new Error("Case not found")
    revalidatePath(DIAGNOSTICS_PATH)
    return {
      success: true,
      data: {
        session,
        residualCount: residuals.length,
        savedAsExceptions: rows.length > 0,
        cascadedClosedCount,
      },
    }
  } catch (error) {
    console.error(
      "[ptt-diagnostics] closeCaseWithAcceptedResidualsAction failed:",
      error
    )
    return { success: false, error: toErrorMessage(error) }
  }
}

const reopenCaseSchema = z.object({ sessionId: sessionIdSchema })
export type ReopenPttCaseInput = z.infer<typeof reopenCaseSchema>

/**
 * Manager-only: reopens a case that was closed with accepted residuals. The
 * exceptions that closure created are deactivated, the case is
 * re-reconciled (or goes back to OPEN when it has no verification scan) and
 * the closure fields are cleared. A fleet-wide closure exception cascades.
 */
export async function reopenPttCaseAction(
  input: ReopenPttCaseInput
): Promise<PttActionResult<{ session: PttSessionDetail }>> {
  try {
    await requireAdmin()
    const { sessionId } = reopenCaseSchema.parse(input)

    const baseline = await db.query.pttDiagnosticSessionsTable.findFirst({
      where: { id: sessionId },
      with: {
        faults: true,
        verificationScans: { columns: { id: true }, limit: 1 },
      },
    })
    if (!baseline || baseline.scanRole !== "BASELINE") {
      throw new Error("Case not found")
    }
    if (baseline.caseStatus !== "CLOSED_ACCEPTED_RESIDUALS") {
      throw new Error("Only a case closed with accepted residuals can be reopened")
    }
    const generation: PttTruckGeneration =
      baseline.truckGeneration === "UNKNOWN"
        ? inferGenerationFromRecords(
            (await loadBaselineSnapshot(baseline)).records
          )
        : baseline.truckGeneration

    // The exceptions this very closure created (same approver, same instant).
    const closureExceptions =
      baseline.closedAt && baseline.closedBy
        ? (
            await db.query.pttApprovedExceptionsTable.findMany({
              where: {
                isActive: true,
                approvedBy: baseline.closedBy,
                approvedAt: { eq: baseline.closedAt },
              },
            })
          ).filter(
            (row) =>
              (row.scope === "TRUCK_SPECIFIC" && row.fleetId === baseline.fleetId) ||
              (row.scope === "FLEET_GENERATION" && row.generation === generation)
          )
        : []
    const exceptionIds = closureExceptions.map((row) => row.id)
    const hadFleetWide = closureExceptions.some(
      (row) => row.scope === "FLEET_GENERATION"
    )

    const now = new Date()
    const reopened = {
      caseStatus: "PARTIAL_BLOCKED" as const,
      workflowStatus: "IN_PROGRESS" as const,
      verifiedAt: null,
      closureMode: null,
      closureReasonCategory: null,
      closureNote: null,
      closedBy: null,
      closedAt: null,
    }

    const statements: BatchItem<"pg">[] = []
    if (exceptionIds.length > 0) {
      statements.push(
        db
          .update(pttApprovedExceptionsTable)
          .set({ isActive: false })
          .where(inArray(pttApprovedExceptionsTable.id, exceptionIds))
      )
    }

    if (baseline.verificationScans.length > 0) {
      const prepared = await prepareCaseReconciliation(baseline.id, {
        withoutExceptionIds: exceptionIds,
        sessionOverride: reopened,
      })
      if (!prepared) throw new Error("Case not found")
      statements.push(...prepared.statements)
    } else {
      // Baseline-only: its accepted faults are open again.
      const ledger = await loadLedgerMap(baseline.fleetId)
      const reopenedKeys = new Set(
        closureExceptions.map((row) => row.canonicalKey)
      )
      const upserts = [...reopenedKeys].flatMap((key) => {
        const entry = ledger.get(key)
        return entry?.ledgerStatus === "APPROVED_EXCEPTION"
          ? [{ ...entry, ledgerStatus: "OPEN" as const }]
          : []
      })
      const ledgerStatement = ledgerUpsertStatement(upserts)
      if (ledgerStatement) statements.push(ledgerStatement)
      statements.push(
        db
          .update(pttDiagnosticSessionsTable)
          .set({
            caseStatus: "OPEN",
            status: reopened.workflowStatus,
            verifiedAt: null,
            closureMode: null,
            closureReasonCategory: null,
            closureNote: null,
            closedBy: null,
            closedAt: null,
            updatedAt: now,
          })
          .where(eq(pttDiagnosticSessionsTable.id, baseline.id))
      )
    }
    await runBatch(statements)

    if (hadFleetWide) {
      await cascadeGenerationReconcile(generation, baseline.id)
    }

    const session = await querySessionDetail(baseline.id)
    if (!session) throw new Error("Case not found")
    revalidatePath(DIAGNOSTICS_PATH)
    return { success: true, data: { session } }
  } catch (error) {
    console.error("[ptt-diagnostics] reopenPttCaseAction failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}