import { get } from "@vercel/blob"
import { eq, inArray } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import OpenAI from "openai"
import { z } from "zod"

import { db } from "@/db"
import { pttDiagnosticSessionsTable, pttFaultCodesTable } from "@/db/schema"
import { HrAuthError, requireAdmin } from "@/lib/hr-admin-auth"
import {
  PTT_IMAGE_CONTENT_TYPES,
  pttVerificationSummarySchema,
} from "@/lib/ptt-diagnostics"

// Vision comparison of several screenshots can take a while.
export const maxDuration = 60

const MAX_VERIFICATION_ATTACHMENTS = 10
const VERIFICATION_MODEL = "gpt-4o"

const sessionIdSchema = z.coerce.number().int().positive()

const verifyRequestSchema = z.object({
  attachmentIds: z
    .array(z.number().int().positive(), {
      error: "At least one verification screenshot is required",
    })
    .min(1, { error: "At least one verification screenshot is required" })
    .max(MAX_VERIFICATION_ATTACHMENTS, {
      error: `At most ${MAX_VERIFICATION_ATTACHMENTS} verification screenshots`,
    }),
})

type RouteContext = { params: Promise<{ id: string }> }

// Expected, user-facing failure with the HTTP status to answer with.
class VerifyError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = "VerifyError"
    this.status = status
  }
}

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status })
}

// "  u300054 " / "MID 128  PSID 200" -> canonical uppercase, single-spaced.
function normalizeFaultCode(code: string): string {
  return code.trim().replace(/\s+/g, " ").toUpperCase()
}

function normalizeCodes(codes: readonly string[]): string[] {
  return [...new Set(codes.map(normalizeFaultCode).filter(Boolean))]
}

const SYSTEM_PROMPT = `You are an Elite Volvo Master Diagnostic Technician acting as the closed-loop QUALITY AUDITOR for Zambezi Portland Cement / Miloto Transport (Ndola, Zambia).

A truck was scanned with Volvo PTT (Premium Tech Tool) BEFORE repair. The workshop has now performed the repair and uploaded one or more AFTER (post-repair) screenshots: a fresh PTT DTC List and / or VCADS Pro operation / calibration result screens. Your job is to compare the BEFORE fault list and verification criteria with what the AFTER screenshots actually show.

HOW TO READ THE AFTER SCREENSHOTS
- Screenshots may be overlapping, scrolled captures of the SAME DTC List, photographed from a laptop screen. Read EVERY row, including the "Active" / "Inactive" state column.
- A VCADS Pro operation that completes successfully (e.g. "Operation completed", calibration finished / OK) means the matching "VCADS-OP-<number>" fault is RESOLVED; a VCADS error pop-up that is still shown means it is STILL ACTIVE.
- Never guess unreadable fields. If a code or its state cannot be read in the AFTER screenshots, do NOT treat it as resolved; list it as still active and say in the summary that it could not be confirmed.

DECISION RULES
- A BEFORE fault is RESOLVED only if it is absent from the AFTER screenshots (a full, clearly readable DTC List) or is explicitly shown as "Inactive" (or its VCADS operation completed).
- A BEFORE fault is STILL ACTIVE if it is visible as "Active" in the AFTER screenshots, or its state cannot be confirmed.
- A NEWLY INTRODUCED fault is an "Active" fault code visible in the AFTER screenshots that was NOT in the BEFORE list and is dangerous or relevant (safety, driveline / engine integrity, derate, or related to the repair just performed). Ignore harmless historical / inactive communication noise.
- Set "verification_passed" to true ONLY if ALL original CRITICAL and CALIBRATION_ONLY faults are resolved (absent or explicitly Inactive) AND no dangerous new Active faults were introduced. Otherwise false. MONITOR / NEGLIGIBLE faults do not block a pass.
- Also check the supplied VERIFICATION CRITERIA against what is visible; if a criterion clearly cannot be met from the screenshots, mention it in the summary.
- Copy fault codes EXACTLY as they appear in the BEFORE list for resolved / still-active codes. Only use codes that are in the BEFORE list for those two arrays, and only codes read from the AFTER screenshots for newly introduced codes.

NEXT ENFORCEMENT ACTION
- If verification passed: a short, firm closing order (e.g. release the truck, clear the directive, keep monitoring any MONITOR codes).
- If failed: a firm, specific order for the Workshop Manager naming the remaining codes, what must be done next (follow the computer-first SOP: PTT live data / calibration first, no parts without proof) and that the truck is NOT released until a new re-scan passes.

OUTPUT
Return ONLY one strict JSON object (no markdown) with exactly these keys:
{
  "verification_passed": boolean,
  "summary": string,                       // concise executive summary (2-4 sentences) of the Before vs After comparison
  "resolved_fault_codes": string[],
  "still_active_fault_codes": string[],
  "newly_introduced_fault_codes": string[],
  "next_enforcement_action": string
}`

// Closes the loop on a PTT scan: compares the stored BEFORE faults and
// verification criteria with the post-repair (`VERIFICATION_SCAN`)
// screenshots using OpenAI Vision, then flags resolved faults and moves the
// session to `VERIFIED_CLOSED` (pass) or back to `IN_PROGRESS` (fail).
// Blob credentials come from the Vercel OIDC environment (no manual `token`).
export async function POST(request: Request, ctx: RouteContext) {
  try {
    await requireAdmin()
  } catch (error) {
    if (error instanceof HrAuthError) return fail(error.message, error.status)
    throw error
  }

  const parsedSessionId = sessionIdSchema.safeParse((await ctx.params).id)
  if (!parsedSessionId.success) return fail("Invalid session id", 400)
  const sessionId = parsedSessionId.data

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail("Expected a JSON body", 400)
  }
  const parsedBody = verifyRequestSchema.safeParse(body)
  if (!parsedBody.success) {
    return fail(parsedBody.error.issues[0]?.message ?? "Invalid request", 400)
  }
  const attachmentIds = [...new Set(parsedBody.data.attachmentIds)]

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new VerifyError("OPENAI_API_KEY is not configured on the server.", 500)
    }

    const session = await db.query.pttDiagnosticSessionsTable.findFirst({
      where: { id: sessionId },
      with: { faults: true, attachments: true },
    })
    if (!session) return fail("Session not found", 404)

    // Only post-repair scans already uploaded for THIS session may be used.
    const selected = attachmentIds.map((id) =>
      session.attachments.find((att) => att.id === id)
    )
    if (selected.some((att) => !att || att.role !== "VERIFICATION_SCAN")) {
      return fail(
        "Every attachment must be a verification re-scan uploaded for this session",
        400
      )
    }
    const verificationAttachments = selected.filter(
      (att): att is NonNullable<typeof att> => att !== undefined
    )

    // Read the private photos for OpenAI Vision.
    const photos = await Promise.all(
      verificationAttachments.map(async (att) => {
        const result = await get(att.blobPathname, { access: "private" })
        if (!result || result.statusCode !== 200) {
          throw new VerifyError(
            `Screenshot "${att.fileName}" was not found in storage`,
            404
          )
        }
        const base64 = Buffer.from(
          await new Response(result.stream).arrayBuffer()
        ).toString("base64")
        const serverType = result.blob.contentType
        const contentType = (
          PTT_IMAGE_CONTENT_TYPES as readonly string[]
        ).includes(serverType)
          ? serverType
          : att.contentType
        return { dataUrl: `data:${contentType};base64,${base64}` }
      })
    )

    const beforeFaults =
      session.faults.length === 0
        ? "(no faults were recorded in the BEFORE scan)"
        : session.faults
            .map(
              (f) =>
                `- ${f.faultCode} [${f.controlUnit}] ${f.componentDescription} | before-state ${f.faultState} | tier ${f.severity}${f.calibrationRequired ? " | calibration required" : ""}`
            )
            .join("\n")
    const criteria = session.aiDirective?.verification_criteria ?? []
    const criteriaText =
      criteria.length === 0
        ? "(none recorded)"
        : criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")

    const userText = [
      `Fleet ID: ${session.fleetId}`,
      `Truck generation: ${session.truckGeneration}`,
      `Original overall severity: ${session.overallSeverity}`,
      `Post-repair screenshots attached: ${photos.length}`,
      "",
      `BEFORE FAULT LIST:\n${beforeFaults}`,
      "",
      `VERIFICATION CRITERIA (from the original directive):\n${criteriaText}`,
    ].join("\n")

    // Under maxDuration; fail fast rather than be killed mid-request.
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 50_000,
      maxRetries: 0,
    })
    const response = await openai.chat.completions.create({
      model: VERIFICATION_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            ...photos.map((p) => ({
              type: "image_url" as const,
              image_url: { url: p.dataUrl, detail: "high" as const },
            })),
          ],
        },
      ],
    })

    const content = response.choices[0]?.message?.content
    if (!content) throw new VerifyError("The AI returned an empty response.", 502)

    let json: unknown
    try {
      json = JSON.parse(content)
    } catch {
      throw new VerifyError("The AI returned invalid JSON. Please try again.", 502)
    }
    const validated = pttVerificationSummarySchema.safeParse(json)
    if (!validated.success) {
      console.error("[ptt-verify] schema mismatch:", validated.error.issues)
      throw new VerifyError(
        "The AI response did not match the expected format. Please try again.",
        502
      )
    }

    const stillActive = normalizeCodes(validated.data.still_active_fault_codes)
    const stillActiveSet = new Set(stillActive)
    const resolved = normalizeCodes(validated.data.resolved_fault_codes).filter(
      (code) => !stillActiveSet.has(code)
    )

    // A pass is impossible while any original fault is still active, however
    // the model phrased its verdict.
    const verificationPassed =
      validated.data.verification_passed && stillActive.length === 0
    const verificationSummary = {
      ...validated.data,
      verification_passed: verificationPassed,
      resolved_fault_codes: resolved,
      still_active_fault_codes: stillActive,
      verified_by_model: response.model || VERIFICATION_MODEL,
    }

    const now = new Date()
    const faultIdsByCode = (codes: Set<string>) =>
      session.faults
        .filter((f) => codes.has(normalizeFaultCode(f.faultCode)))
        .map((f) => f.id)
    const resolvedFaultIds = faultIdsByCode(new Set(resolved))
    const stillActiveFaultIds = faultIdsByCode(stillActiveSet)

    // One atomic batch: fault flags + session verdict.
    const statements: [BatchItem<"pg">, ...BatchItem<"pg">[]] = [
      db
        .update(pttDiagnosticSessionsTable)
        .set(
          verificationPassed
            ? {
                verificationSummary,
                updatedAt: now,
                status: "VERIFIED_CLOSED",
                verifiedAt: now,
              }
            : {
                verificationSummary,
                updatedAt: now,
                status: "IN_PROGRESS",
                verifiedAt: null,
              }
        )
        .where(eq(pttDiagnosticSessionsTable.id, sessionId)),
    ]
    if (resolvedFaultIds.length > 0) {
      statements.push(
        db
          .update(pttFaultCodesTable)
          .set({ resolvedOnRescan: true })
          .where(inArray(pttFaultCodesTable.id, resolvedFaultIds))
      )
    }
    if (stillActiveFaultIds.length > 0) {
      statements.push(
        db
          .update(pttFaultCodesTable)
          .set({ resolvedOnRescan: false })
          .where(inArray(pttFaultCodesTable.id, stillActiveFaultIds))
      )
    }
    await db.batch(statements)

    const updated = await db.query.pttDiagnosticSessionsTable.findFirst({
      where: { id: sessionId },
      with: { faults: true, attachments: true },
    })
    if (!updated) throw new VerifyError("Session not found", 404)

    revalidatePath("/diagnostics")
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error("[ptt-verify] verification failed:", error)
    if (error instanceof VerifyError) return fail(error.message, error.status)
    return fail("Verification failed. Please try again.", 500)
  }
}
