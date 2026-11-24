import { del, put } from "@vercel/blob"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { z } from "zod"

import { db } from "@/db"
import {
  pttDiagnosticSessionsTable,
  pttSessionAttachmentsTable,
} from "@/db/schema"
import { adminGuard } from "@/lib/hr-admin-auth"
import {
  PTT_ATTACHMENT_ROLES,
  normalizeFleetId,
} from "@/lib/ptt-diagnostics"
import {
  sanitizeFileName,
  sanitizeFleetIdForPath,
  validateImageFile,
} from "@/lib/ptt-files"

const fleetIdSchema = z
  .string({ error: "Fleet ID is required" })
  .transform(normalizeFleetId)
  .pipe(
    z
      .string()
      .min(1, { error: "Fleet ID is required" })
      .max(50, { error: "Fleet ID is too long" })
  )
const sessionIdSchema = z.coerce.number().int().positive()
const roleSchema = z.enum(PTT_ATTACHMENT_ROLES)

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status })
}

// Treats a missing / blank form field as "not provided".
function optionalField(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return undefined
  return value.trim() === "" ? undefined : value.trim()
}

// Uploads one PTT screenshot to private Vercel Blob storage. Credentials come
// from the Vercel OIDC environment — no manual `token` is passed.
//
// - With `sessionId`: the screenshot is attached to that session straight away.
// - Without it: the blob metadata is returned so the client can upload several
//   photos first, then pass the array to `/api/diagnostics/analyze`.
export async function POST(request: Request) {
  const denied = await adminGuard()
  if (denied) return denied

  let uploadedUrl: string | null = null

  try {
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return fail("Expected multipart/form-data", 400)
    }

    const file = formData.get("file")
    if (!(file instanceof File)) return fail("No file provided", 400)
    const problem = validateImageFile(file)
    if (problem) return fail(problem, 400)

    const fleetId = fleetIdSchema.safeParse(formData.get("fleetId"))
    if (!fleetId.success) {
      return fail(fleetId.error.issues[0]?.message ?? "Invalid Fleet ID", 400)
    }

    const rawSessionId = optionalField(formData.get("sessionId"))
    let sessionId: number | undefined
    if (rawSessionId !== undefined) {
      const parsed = sessionIdSchema.safeParse(rawSessionId)
      if (!parsed.success) return fail("Invalid session id", 400)
      sessionId = parsed.data
    }

    const rawRole = optionalField(formData.get("role"))
    const role = roleSchema.safeParse(rawRole ?? "INITIAL_SCAN")
    if (!role.success) return fail("Invalid attachment role", 400)

    if (sessionId !== undefined) {
      const [session] = await db
        .select({ id: pttDiagnosticSessionsTable.id })
        .from(pttDiagnosticSessionsTable)
        .where(eq(pttDiagnosticSessionsTable.id, sessionId))
      if (!session) return fail("Session not found", 404)
    }

    const sanitizedFleetId = sanitizeFleetIdForPath(fleetId.data)
    const sanitizedName = sanitizeFileName(file.name)

    const blob = await put(
      `ptt-diagnostics/${sanitizedFleetId}/${sanitizedName}`,
      file,
      { access: "private", addRandomSuffix: true }
    )
    uploadedUrl = blob.url

    if (sessionId === undefined) {
      return NextResponse.json({
        success: true,
        data: {
          fileName: sanitizedName,
          blobPathname: blob.pathname,
          blobUrl: blob.url,
          contentType: file.type,
          fileSize: file.size,
        },
      })
    }

    const [inserted] = await db
      .insert(pttSessionAttachmentsTable)
      .values({
        sessionId,
        role: role.data,
        fileName: sanitizedName,
        blobPathname: blob.pathname,
        blobUrl: blob.url,
        contentType: file.type,
        fileSize: file.size,
      })
      .returning()

    revalidatePath("/diagnostics")
    return NextResponse.json({ success: true, data: inserted })
  } catch (error) {
    // Don't leave a blob behind that nothing points at.
    console.error("[ptt-upload] upload failed:", error)
    if (uploadedUrl) {
      await del(uploadedUrl).catch((cleanupError) =>
        console.error("[ptt-upload] blob cleanup failed:", cleanupError)
      )
    }
    return fail("Upload failed", 500)
  }
}
