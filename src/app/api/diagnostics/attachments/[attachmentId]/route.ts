import { get } from "@vercel/blob"
import { eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { z } from "zod"

import { db } from "@/db"
import { pttSessionAttachmentsTable } from "@/db/schema"
import { adminGuard } from "@/lib/hr-admin-auth"

const attachmentIdSchema = z.coerce.number().int().positive()

type RouteContext = { params: Promise<{ attachmentId: string }> }

// Streams a private PTT screenshot through the server so it is only reachable
// by signed-in admins — the blob URL itself is never exposed to the browser.
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
        blobPathname: pttSessionAttachmentsTable.blobPathname,
        fileName: pttSessionAttachmentsTable.fileName,
        contentType: pttSessionAttachmentsTable.contentType,
      })
      .from(pttSessionAttachmentsTable)
      .where(eq(pttSessionAttachmentsTable.id, parsedId.data))
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
    console.error("[ptt-attachments] fetch failed:", error)
    return NextResponse.json(
      { success: false, error: "Could not load screenshot" },
      { status: 500 }
    )
  }
}
