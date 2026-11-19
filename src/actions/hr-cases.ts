"use server"

import { auth } from "@clerk/nextjs/server"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import {
  HR_DISCIPLINARY_STATUSES,
  hrDisciplinaryCasesTable,
} from "@/db/schema"

// Every action resolves to a plain `{ success, ... }` object. Raw Error
// instances must never cross the Server -> Client boundary.
export type HrCaseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export type DisciplinaryCaseWithAttachments = Awaited<
  ReturnType<typeof queryCases>
>[number]

const HR_PAGE_PATH = "/hr/disciplinary"

const requiredText = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, { error: `${label} is required` })

// The 7 docxtemplater fields (`DISCIPLINARY_FIELDS` in
// src/lib/hr-disciplinary.ts). Kept explicit so the inferred type stays
// precise; strict so unexpected keys are rejected rather than stored.
const documentPayloadSchema = z.strictObject({
  driver_name: z.string().trim(),
  employee_no: z.string().trim(),
  date: z.string().trim(),
  incident_details: z.string().trim(),
  formatted_charges: z.string().trim(),
  penalty_amount: z.string().trim(),
  deduction_clause: z.string().trim(),
})

const logDisciplinaryCaseSchema = z.object({
  caseRef: requiredText("Case Ref"),
  fleetId: requiredText("Fleet ID"),
  employeeNo: z.string().trim(),
  driverName: z.string().trim(),
  documentPayload: documentPayloadSchema,
})

export type LogDisciplinaryCaseInput = z.infer<typeof logDisciplinaryCaseSchema>

const caseIdSchema = z.number().int().positive()

const updateDisciplinaryCaseSchema = z
  .object({
    status: z.enum(HR_DISCIPLINARY_STATUSES).optional(),
    disputeNote: z.string().trim().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.disputeNote !== undefined, {
    error: "Nothing to update",
  })

export type UpdateDisciplinaryCaseInput = z.infer<
  typeof updateDisciplinaryCaseSchema
>

// Verifies a Clerk session with the admin role (matches the page-level gate
// and `generateDisciplinaryData`). Throws; callers catch and convert to a
// plain error result.
async function requireAdmin() {
  const { userId, sessionClaims } = await auth()
  if (!userId) throw new Error("Unauthorized")
  if (sessionClaims?.metadata?.role !== "admin") throw new Error("Forbidden")
  return userId
}

function toErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Invalid input"
  }
  return error instanceof Error ? error.message : "Unknown error"
}

function queryCases() {
  return db.query.hrDisciplinaryCasesTable.findMany({
    with: { attachments: true },
    orderBy: { generatedAt: "desc" },
  })
}

// Logs a case when its .docx is downloaded. Both the Notice of Charge and the
// Notice of Penalty call this with the same `caseRef`, so the second call
// refreshes the existing row instead of creating a duplicate card. `status`
// is deliberately absent from the conflict `set`, so a case that has already
// moved on (e.g. DISPUTED) keeps its status.
export async function logDisciplinaryCase(
  input: LogDisciplinaryCaseInput
): Promise<HrCaseResult<{ id: number; caseRef: string }>> {
  try {
    const userId = await requireAdmin()
    const data = logDisciplinaryCaseSchema.parse(input)

    const now = new Date()
    const [row] = await db
      .insert(hrDisciplinaryCasesTable)
      .values({
        caseRef: data.caseRef,
        fleetId: data.fleetId,
        employeeNo: data.employeeNo,
        driverName: data.driverName,
        documentPayload: data.documentPayload,
        status: "AWAITING_SIGNATURE",
        generatedAt: now,
        createdBy: userId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: hrDisciplinaryCasesTable.caseRef,
        set: {
          fleetId: data.fleetId,
          employeeNo: data.employeeNo,
          driverName: data.driverName,
          documentPayload: data.documentPayload,
          generatedAt: now,
          updatedAt: now,
        },
      })
      .returning({
        id: hrDisciplinaryCasesTable.id,
        caseRef: hrDisciplinaryCasesTable.caseRef,
      })

    revalidatePath(HR_PAGE_PATH)
    return { success: true, data: row }
  } catch (error) {
    console.error("[hr-cases] logDisciplinaryCase failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}

export async function getDisciplinaryCases(): Promise<
  HrCaseResult<DisciplinaryCaseWithAttachments[]>
> {
  try {
    await requireAdmin()
    return { success: true, data: await queryCases() }
  } catch (error) {
    console.error("[hr-cases] getDisciplinaryCases failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}

// Status can move freely forward or backward. `closedAt` is stamped on
// entering CLOSED and cleared on leaving it.
export async function updateDisciplinaryCase(
  id: number,
  updates: UpdateDisciplinaryCaseInput
): Promise<HrCaseResult<{ id: number }>> {
  try {
    await requireAdmin()
    const caseId = caseIdSchema.parse(id)
    const data = updateDisciplinaryCaseSchema.parse(updates)

    const now = new Date()
    const set: Partial<typeof hrDisciplinaryCasesTable.$inferInsert> = {
      updatedAt: now,
    }
    if (data.status !== undefined) {
      set.status = data.status
      set.closedAt = data.status === "CLOSED" ? now : null
    }
    if (data.disputeNote !== undefined) {
      set.disputeNote = data.disputeNote === "" ? null : data.disputeNote
    }

    const [row] = await db
      .update(hrDisciplinaryCasesTable)
      .set(set)
      .where(eq(hrDisciplinaryCasesTable.id, caseId))
      .returning({ id: hrDisciplinaryCasesTable.id })
    if (!row) throw new Error("Case not found")

    revalidatePath(HR_PAGE_PATH)
    return { success: true, data: row }
  } catch (error) {
    console.error("[hr-cases] updateDisciplinaryCase failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}

export async function deleteDisciplinaryCase(
  id: number
): Promise<HrCaseResult<{ id: number }>> {
  try {
    await requireAdmin()
    const caseId = caseIdSchema.parse(id)

    const [row] = await db
      .delete(hrDisciplinaryCasesTable)
      .where(eq(hrDisciplinaryCasesTable.id, caseId))
      .returning({ id: hrDisciplinaryCasesTable.id })
    if (!row) throw new Error("Case not found")

    revalidatePath(HR_PAGE_PATH)
    return { success: true, data: row }
  } catch (error) {
    console.error("[hr-cases] deleteDisciplinaryCase failed:", error)
    return { success: false, error: toErrorMessage(error) }
  }
}
