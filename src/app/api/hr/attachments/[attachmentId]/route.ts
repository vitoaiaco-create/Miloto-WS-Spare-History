import { del, get } from "@vercel/blob"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import { z } from "zod"

import { db } from "@/db"
import { hrDisciplinaryAttachmentsTable } from "@/db/schema"
import { adminGuard } from "@/lib/hr-admin-auth"

const attachmentIdSchema = z.coerce.number().int().positive()

type RouteContext = { params: Promise<{ attachmentId: string }> }

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status })
}

// Streams a private blob through the server so it is only reachable by
// signed-in admins — the blob URL itself is never exposed to the browser.
// Credentials come from the Vercel OIDC environment (no manual `token`).
export async function GET(_request: Request, ctx: RouteContext) {
  const denied = await adminGuard()
  if (denied) return denied

  try {
    const parsedId = attachmentIdSchema.safeParse(
      (await ctx.params).attachmentId
    )
    if (!parsedId.success) return new NextResponse("Not found", { status: 404 })

    const [row] = await db
      .select({
        blobPathname: hrDisciplinaryAttachmentsTable.blobPathname,
        fileName: hrDisciplinaryAttachmentsTable.fileName,
        contentType: hrDisciplinaryAttachmentsTable.contentType,
      })
      .from(hrDisciplinaryAttachmentsTable)
      .where(eq(hrDisciplinaryAttachmentsTable.id, parsedId.data))
    if (!row) return new NextResponse("Not found", { status: 404 })

    const result = await get(row.blobPathname, { access: "private" })
    if (!result || result.statusCode !== 200) {
      return new NextResponse("Not found", { status: 404 })
    }

    // Quotes / control characters would break out of the header value.
    const safeFileName = row.fileName.replace(/["\r\n]/g, "")

    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType || row.contentType,
        "Content-Disposition": `inline; filename="${safeFileName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-cache",
      },
    })
  } catch (error) {
    console.error("[hr-attachments] fetch failed:", error)
    return fail("Could not load document", 500)
  }
}

export async function DELETE(_request: Request, ctx: RouteContext) {
  const denied = await adminGuard()
  if (denied) return denied

  try {
    const parsedId = attachmentIdSchema.safeParse(
      (await ctx.params).attachmentId
    )
    if (!parsedId.success) return fail("Attachment not found", 404)

    const [row] = await db
      .select({
        id: hrDisciplinaryAttachmentsTable.id,
        blobUrl: hrDisciplinaryAttachmentsTable.blobUrl,
      })
      .from(hrDisciplinaryAttachmentsTable)
      .where(eq(hrDisciplinaryAttachmentsTable.id, parsedId.data))
    if (!row) return fail("Attachment not found", 404)

    // Blob first: if it fails the row stays and the delete can be retried.
    await del(row.blobUrl)
    await db
      .delete(hrDisciplinaryAttachmentsTable)
      .where(eq(hrDisciplinaryAttachmentsTable.id, row.id))

    revalidatePath("/hr/disciplinary")
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[hr-attachments] delete failed:", error)
    return fail("Delete failed", 500)
  }
}
