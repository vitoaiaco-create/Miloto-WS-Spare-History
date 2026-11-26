"use server"

import { del } from "@vercel/blob"
import { and, eq, inArray } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import {
  pttApprovedExceptionsTable,
  pttDiagnosticSessionsTable,
  pttSessionAttachmentsTable,
  pttTruckFaultLedgerTable,
} from "@/db/schema"
import { requireAdmin } from "@/lib/hr-admin-auth"
import { PTT_SESSION_STATUSES, type PttSessionStatus } from "@/lib/ptt-diagnostics"
import {
  loadApplicableExceptions,
  loadBaselineSnapshot,
  recordFromScanFaultRow,
  updateScanFaultBucket,
} from "@/lib/ptt/case-db"
import {
  MANUAL_CLOSE_BLOCKED_MESSAGE,
  canManuallyMarkVerifiedClosed,
} from "@/lib/ptt/closure-guard"
import {
  PTT_EXCEPTION_REASON_CATEGORIES,
  PTT_EXCEPTION_SCOPES,
} from "@/lib/ptt/constants"
import {
  matchesApprovedException,
  reconcileDiagnosticScans,
  type ApprovedExceptionRule,
} from "@/lib/ptt/reconcile"
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
// that needs a passing verification scan (see `canManuallyMarkVerifiedClosed`).
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
        !canManuallyMarkVerifiedClosed({
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
// Approved exceptions
// ---------------------------------------------------------------------------

const approveExceptionSchema = z.object({
  // The case's baseline scan id (the session shown in the case view).
  sessionId: sessionIdSchema,
  canonicalKey: z
    .string({ error: "Fault key is required" })
    .trim()
    .min(1, { error: "Fault key is required" })
    .max(200),
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
})

export type ApprovePttExceptionInput = z.infer<typeof approveExceptionSchema>

/**
 * Approves an exception for a fault that is still open (or newly appeared) on
 * the case's latest verification scan, then re-evaluates that scan: buckets,
 * the equation counts, the case status and the truck ledger are all updated
 * in one atomic batch together with the new exception row.
 */
export async function approvePttException(
  input: ApprovePttExceptionInput
): Promise<PttActionResult<PttSessionDetail>> {
  try {
    const userId = await requireAdmin()
    const data = approveExceptionSchema.parse(input)

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
    const latest = baseline.verificationScans[0]
    if (!latest) {
      throw new Error("This case has no verification scan to re-evaluate yet")
    }

    const target = latest.scanFaults.find(
      (fault) => fault.canonicalKey === data.canonicalKey
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

    const generation = baseline.truckGeneration
    if (data.scope === "FLEET_GENERATION" && generation === "UNKNOWN") {
      throw new Error(
        "This truck's generation is unknown, so a fleet-wide exception cannot be created. Use a truck-specific exception."
      )
    }

    const newRule: ApprovedExceptionRule = {
      scope: data.scope,
      generation: data.scope === "FLEET_GENERATION" && generation !== "UNKNOWN" ? generation : null,
      fleetId: data.scope === "TRUCK_SPECIFIC" ? baseline.fleetId : null,
      canonicalKey: data.canonicalKey,
      isActive: true,
    }
    const rules = [
      ...(await loadApplicableExceptions(baseline.fleetId, generation)),
      newRule,
    ]

    // Re-run the pure diff with the new exception.
    const snapshot = await loadBaselineSnapshot(baseline)
    const extractedRows = latest.scanFaults.filter((fault) => fault.isExtracted)
    const result = reconcileDiagnosticScans({
      fleetId: baseline.fleetId,
      generation,
      baselineFaults: snapshot.records,
      verificationFaults: extractedRows.map(recordFromScanFaultRow),
      exceptions: rules,
      bounceBackKeys: new Set(
        extractedRows
          .filter((fault) => fault.isBounceBack)
          .map((fault) => fault.canonicalKey)
      ),
    })
    const bucketByKey = new Map(
      result.faults.map((fault) => [fault.canonicalKey, fault.bucket])
    )

    const now = new Date()
    const closed = result.caseStatus === "VERIFIED_CLOSED"
    const statements: BatchItem<"pg">[] = [
      db
        .insert(pttApprovedExceptionsTable)
        .values({
          scope: newRule.scope,
          generation: newRule.generation,
          fleetId: newRule.fleetId,
          canonicalKey: newRule.canonicalKey,
          reasonCategory: data.reasonCategory,
          physicalProofNote: data.physicalProofNote,
          approvedBy: userId,
        })
        // Already covered by an identical active rule: nothing to add.
        .onConflictDoNothing(),
    ]
    for (const row of latest.scanFaults) {
      const bucket = bucketByKey.get(row.canonicalKey) ?? null
      const isApprovedException = matchesApprovedException(
        rules,
        baseline.fleetId,
        generation,
        row.canonicalKey
      )
      if (
        bucket !== row.reconciliationBucket ||
        isApprovedException !== row.isApprovedException
      ) {
        statements.push(
          updateScanFaultBucket(row.id, {
            reconciliationBucket: bucket,
            isApprovedException,
          })
        )
      }
    }
    statements.push(
      db
        .update(pttTruckFaultLedgerTable)
        .set({ ledgerStatus: "APPROVED_EXCEPTION" })
        .where(
          and(
            eq(pttTruckFaultLedgerTable.fleetId, baseline.fleetId),
            eq(pttTruckFaultLedgerTable.canonicalKey, data.canonicalKey),
            inArray(pttTruckFaultLedgerTable.ledgerStatus, ["OPEN", "REOPENED"])
          )
        ),
      db
        .update(pttDiagnosticSessionsTable)
        .set({
          caseStatus: result.caseStatus,
          reconciliationSummary: result.summary,
          updatedAt: now,
        })
        .where(eq(pttDiagnosticSessionsTable.id, latest.id)),
      db
        .update(pttDiagnosticSessionsTable)
        .set({
          caseStatus: result.caseStatus,
          reconciliationSummary: result.summary,
          status: closed ? "VERIFIED_CLOSED" : "IN_PROGRESS",
          verifiedAt: closed ? now : null,
          updatedAt: now,
        })
        .where(eq(pttDiagnosticSessionsTable.id, baseline.id))
    )
    const [first, ...rest] = statements
    await db.batch([first, ...rest])

    const updated = await querySessionDetail(baseline.id)
    if (!updated) throw new Error("Case not found")

    revalidatePath(DIAGNOSTICS_PATH)
    return { success: true, data: updated }
  } catch (error) {
    console.error("[ptt-diagnostics] approvePttException failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}
