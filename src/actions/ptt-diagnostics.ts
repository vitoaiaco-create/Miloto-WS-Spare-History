"use server"

import { del } from "@vercel/blob"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import {
  pttDiagnosticSessionsTable,
  pttSessionAttachmentsTable,
} from "@/db/schema"
import { requireAdmin } from "@/lib/hr-admin-auth"
import { PTT_SESSION_STATUSES, type PttSessionStatus } from "@/lib/ptt-diagnostics"

// Every action resolves to a plain `{ success, ... }` object. Raw Error
// instances must never cross the Server -> Client boundary.
export type PttActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export type PttSessionDetail = NonNullable<
  Awaited<ReturnType<typeof querySession>>
>

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

function querySession(sessionId: number) {
  return db.query.pttDiagnosticSessionsTable.findFirst({
    where: { id: sessionId },
    with: { faults: true, attachments: true },
  })
}

// Status can move freely forward or backward. `verifiedAt` is stamped on
// entering VERIFIED_CLOSED and cleared on leaving it.
export async function updatePttSessionStatus(
  sessionId: number,
  status: PttSessionStatus
): Promise<PttActionResult<{ id: number; status: PttSessionStatus }>> {
  try {
    await requireAdmin()
    const id = sessionIdSchema.parse(sessionId)
    const nextStatus = statusSchema.parse(status)

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
    const attachments = await db
      .select({ blobUrl: pttSessionAttachmentsTable.blobUrl })
      .from(pttSessionAttachmentsTable)
      .where(eq(pttSessionAttachmentsTable.sessionId, id))
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

    const session = await querySession(id)
    if (!session) throw new Error("Session not found")

    return { success: true, data: session }
  } catch (error) {
    console.error("[ptt-diagnostics] getPttSessionById failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}
