import { del, put } from "@vercel/blob"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { z } from "zod"

import { db } from "@/db"
import {
  hrDisciplinaryAttachmentsTable,
  hrDisciplinaryCasesTable,
} from "@/db/schema"
import { adminGuard } from "@/lib/hr-admin-auth"
import {
  HR_ATTACHMENT_DOC_LABELS,
  HR_ATTACHMENT_EXTENSIONS,
  HR_ATTACHMENT_MAX_BYTES,
} from "@/lib/hr-disciplinary"

const MAX_FILES_PER_REQUEST = 10

const caseIdSchema = z.coerce.number().int().positive()
const docLabelSchema = z.enum(HR_ATTACHMENT_DOC_LABELS)

// Extension -> the only MIME types accepted for it.
const ALLOWED_TYPES: Record<
  (typeof HR_ATTACHMENT_EXTENSIONS)[number],
  readonly string[]
> = {
  ".pdf": ["application/pdf"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
}

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status })
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(dot).toLowerCase()
}

// Strips any path, keeps `[A-Za-z0-9._-]`, and caps the length (keeping the
// extension) so the name is safe in a blob pathname and a header.
function sanitizeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? ""
  const ext = extensionOf(base)
  const stem = (ext ? base.slice(0, -ext.length) : base)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100)
  return `${stem || "document"}${ext}`
}

function validateFile(file: File): string | null {
  const ext = extensionOf(file.name)
  const allowed = (ALLOWED_TYPES as Record<string, readonly string[]>)[ext]
  if (!allowed) {
    return `"${file.name}" is not allowed. Use PDF, JPG or PNG files.`
  }
  if (!allowed.includes(file.type)) {
    return `"${file.name}" has an unsupported file type (${file.type || "unknown"}).`
  }
  if (file.size === 0) return `"${file.name}" is empty.`
  if (file.size > HR_ATTACHMENT_MAX_BYTES) {
    return `"${file.name}" is larger than 4.5 MB.`
  }
  return null
}

// Uploads one or more signed documents for a case to private Vercel Blob
// storage. Credentials come from the Vercel OIDC environment — no manual
// `token` is passed.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await adminGuard()
  if (denied) return denied

  try {
    const parsedId = caseIdSchema.safeParse((await ctx.params).id)
    if (!parsedId.success) return fail("Invalid case id", 400)
    const caseId = parsedId.data

    const [caseRow] = await db
      .select({ id: hrDisciplinaryCasesTable.id })
      .from(hrDisciplinaryCasesTable)
      .where(eq(hrDisciplinaryCasesTable.id, caseId))
    if (!caseRow) return fail("Case not found", 404)

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return fail("Expected multipart/form-data", 400)
    }

    const docLabel = docLabelSchema.safeParse(formData.get("docLabel"))
    if (!docLabel.success) return fail("Invalid document label", 400)

    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File)
    if (files.length === 0) return fail("No files provided", 400)
    if (files.length > MAX_FILES_PER_REQUEST) {
      return fail(`Upload at most ${MAX_FILES_PER_REQUEST} files at a time`, 400)
    }

    // Validate everything before uploading anything.
    for (const file of files) {
      const problem = validateFile(file)
      if (problem) return fail(problem, 400)
    }

    const uploaded: {
      fileName: string
      blobPathname: string
      blobUrl: string
      contentType: string
      fileSize: number
    }[] = []

    try {
      for (const file of files) {
        const sanitizedName = sanitizeFileName(file.name)
        const blob = await put(
          `hr-disciplinary/case-${caseId}/${sanitizedName}`,
          file,
          { access: "private", addRandomSuffix: true }
        )
        uploaded.push({
          fileName: sanitizedName,
          blobPathname: blob.pathname,
          blobUrl: blob.url,
          contentType: file.type,
          fileSize: file.size,
        })
      }

      const insertedRows = await db
        .insert(hrDisciplinaryAttachmentsTable)
        .values(
          uploaded.map((u) => ({
            caseId,
            fileName: u.fileName,
            docLabel: docLabel.data,
            blobPathname: u.blobPathname,
            blobUrl: u.blobUrl,
            contentType: u.contentType,
            fileSize: u.fileSize,
          }))
        )
        .returning()

      revalidatePath("/hr/disciplinary")
      return NextResponse.json({ success: true, data: insertedRows })
    } catch (error) {
      // Don't leave blobs behind that no row points at.
      if (uploaded.length > 0) {
        await del(uploaded.map((u) => u.blobUrl)).catch((cleanupError) =>
          console.error("[hr-attachments] blob cleanup failed:", cleanupError)
        )
      }
      throw error
    }
  } catch (error) {
    console.error("[hr-attachments] upload failed:", error)
    return fail("Upload failed", 500)
  }
}