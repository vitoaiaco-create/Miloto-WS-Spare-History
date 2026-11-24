import { del, get } from "@vercel/blob"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import OpenAI from "openai"
import { z } from "zod"

import { db } from "@/db"
import {
  pttDiagnosticSessionsTable,
  pttFaultCodesTable,
  pttSessionAttachmentsTable,
} from "@/db/schema"
import { HrAuthError, requireAdmin } from "@/lib/hr-admin-auth"
import {
  PTT_FAULT_SEVERITIES,
  PTT_IMAGE_CONTENT_TYPES,
  PTT_IMAGE_MAX_BYTES,
  PTT_TRUCK_GENERATIONS,
  normalizeFleetId,
  pttAnalysisResultSchema,
  summarizePttFaults,
  type PttFault,
  type PttSparesContextItem,
} from "@/lib/ptt-diagnostics"
import { pttBlobPrefix } from "@/lib/ptt-files"

// Vision analysis of several screenshots can take a while.
export const maxDuration = 60

const MAX_ATTACHMENTS = 10
const SPARES_WINDOW_DAYS = 90
const SPARES_MAX_LINES = 30
const PRIOR_SESSIONS_LIMIT = 2

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null))

const analyzeRequestSchema = z.object({
  fleetId: z
    .string({ error: "Fleet ID is required" })
    .transform(normalizeFleetId)
    .pipe(
      z
        .string()
        .min(1, { error: "Fleet ID is required" })
        .max(50, { error: "Fleet ID is too long" })
    ),
  truckGeneration: z.enum(PTT_TRUCK_GENERATIONS),
  odometerKm: z.number().int().nonnegative().nullish(),
  scanBatchLabel: optionalText(200),
  workshopContext: optionalText(4000),
  attachments: z
    .array(
      z.object({
        fileName: z.string().trim().min(1).max(255),
        blobPathname: z.string().trim().min(1).max(1024),
        blobUrl: z.string().trim().min(1).max(2048),
        contentType: z.enum(PTT_IMAGE_CONTENT_TYPES),
        fileSize: z.number().int().positive().max(PTT_IMAGE_MAX_BYTES),
      }),
      { error: "At least one screenshot is required" }
    )
    .min(1, { error: "At least one screenshot is required" })
    .max(MAX_ATTACHMENTS, {
      error: `At most ${MAX_ATTACHMENTS} screenshots per analysis`,
    }),
})

// Expected, user-facing failure with the HTTP status to answer with.
class AnalyzeError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = "AnalyzeError"
    this.status = status
  }
}

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status })
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an Elite Volvo Master Diagnostic Technician & Fleet Operations Strategist for Zambezi Portland Cement / Miloto Transport (Ndola, Zambia).

FLEET YOU SUPPORT
- Volvo FH V3: D13 engine, I-Shift gearbox AT2612D / AT2412C. Fault codes use the classic format "MID / PID / PPID / SID / PSID + FMI" (e.g. "MID 128 PID 94 FMI 1", "MID 128 PSID 200 FMI 12").
- Volvo FH V4: D13 engine, I-Shift gearbox AT2612F. Fault codes are UDS hex codes such as U300054, P105F18, P008A00.
You will receive one or more Volvo PTT (Premium Tech Tool) screenshots of the SAME truck. They may be scrolled captures that overlap, so the same fault code can appear in several screenshots.

PHOTO READING NOTES
- Workshop photos are often taken of a laptop screen and may be overlapping, scrolled screens of the SAME "DTC List". A single screen can hold ~20 dense rows with small text, including the right-edge "Active" / "Inactive" state column.
- Read EVERY visible row carefully, in every photo. On FH V3 read the full "MID / PID / PPID / SID / PSID + FMI" identifier of each row; on FH V4 read the full UDS hex code (e.g. U300054, P105F18).
- Never guess or invent unreadable fields: if a code, state or count is blurry or cut off, use fault_state "UNKNOWN" / occurrence_count null (or skip the row if the code itself cannot be read) and mention the limitation in evidence_analysis.

STRICT "COMPUTER-FIRST" SOP (fight the workshop "parts cannon" mentality)
1. Never approve a physical teardown, or an expensive module / wiring harness / injector / APM (Air Processing Module) replacement, without PTT Live Data proof (e.g. measured values, injector balancing / compression test results, pressure build-up data, sensor readouts). If the screenshots do not contain such proof, say what PTT Live Data / test must be run FIRST and approve NO parts.
2. Flag missing post-repair PTT software calibrations as CALIBRATION_ONLY with ZERO parts approved. Typical examples: clutch X1 wear / kiss-point calibration, APM air leakage initialisation, injector trim code (C3I / IMA) coding after injector or ECU work, actuator / gear-selector calibration. Set calibration_required = true on these faults.
3. Cross-check every extracted fault against the supplied "90-DAY SPARES HISTORY" and "PRIOR PTT SCANS". Explicitly call out repeat part replacements (e.g. recently replaced injectors, solenoids, clutches, APMs, sensors) and recurring or unresolved codes. When a related part was already replaced, do NOT recommend replacing the same part again; instead suspect upstream root causes such as fuel contamination or poor fuel quality, intake / air leaks, skipped calibration, damaged harness pins / connectors / corrosion, or a wrong / non-genuine part. Reference the specific spares line (date, part number, job card) or prior scan in evidence_analysis and root_cause_summary.
4. Deduplicate: a fault code that appears in several overlapping scrolled screenshots must be returned ONCE (keep the most informative occurrence count / state).
5. Only report faults you can actually read in the screenshots. Never invent codes. If a screenshot is unreadable or contains no fault list, return an empty faults array and explain in evidence_analysis.

SEVERITY CATEGORIES - classify EVERY fault into exactly one of:
- "CRITICAL": active fault that threatens safety, engine / driveline integrity, derate / limp mode, or has proven failed hardware.
- "CALIBRATION_ONLY": cleared by a missing / required PTT software calibration or initialisation; zero parts.
- "MONITOR": intermittent, inactive-but-recurring, or low-impact fault to watch and re-scan.
- "NEGLIGIBLE": historical / inactive / communication-noise codes with no action needed.

OUTPUT
Return ONLY one strict JSON object (no markdown) with exactly these keys:
{
  "detected_generation": "FH_V3" | "FH_V4" | "UNKNOWN",
  "odometer_km": number | null,            // read from the screenshots if visible, else null
  "overall_severity": "CRITICAL" | "CALIBRATION_ONLY" | "MONITOR" | "NEGLIGIBLE" | "CLEAR",  // worst fault tier, CLEAR if no faults
  "faults": [
    {
      "fault_code": string,                // normalised uppercase, e.g. "U300054" or "MID 128 PSID 200 FMI 12"
      "code_format": "V3_MID_FMI" | "V4_UDS" | "OTHER",
      "control_unit": string,              // e.g. "EMS", "TECU", "APM", "VMCU", "MID 130"
      "component_description": string,
      "fault_state": "ACTIVE" | "INACTIVE" | "UNKNOWN",
      "occurrence_count": number | null,
      "severity": "CRITICAL" | "CALIBRATION_ONLY" | "MONITOR" | "NEGLIGIBLE",
      "root_cause_summary": string,        // most likely true root cause, citing spares / prior-scan evidence where relevant
      "calibration_required": boolean
    }
  ],
  "directive": {
    "evidence_analysis": string,           // what the screenshots, spares history and prior scans show
    "parts_cannon_warning": string,        // which parts must NOT be replaced yet and why ("" if none)
    "true_diagnosis": string,              // the single most likely true diagnosis for the Workshop Manager
    "physical_inspections": string[],      // cheap physical checks to do first (harness pins, air leaks, fuel quality ...)
    "ptt_navigation_paths": string[],      // exact PTT menu paths for live data / tests / calibrations
    "verification_criteria": string[]      // measurable pass criteria for the re-scan
  }
}`

// ---------------------------------------------------------------------------
// Server-side context
// ---------------------------------------------------------------------------

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

// Last 90 days of spares issued to the truck (capped to the 30 most recent
// lines). The truck is resolved through `assetsTable.assetName`.
async function loadSparesContext(
  fleetId: string
): Promise<PttSparesContextItem[]> {
  const asset = await db.query.assetsTable.findFirst({
    columns: { id: true },
    where: { assetName: fleetId },
  })
  if (!asset) return []

  const cutoff = isoDate(
    new Date(Date.now() - SPARES_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  )
  const rows = await db.query.mechanicalSparesTable.findMany({
    columns: {
      outwardDate: true,
      partNumber: true,
      materialName: true,
      quantity: true,
      amountUsd: true,
      jobCardNo: true,
    },
    where: { assetId: asset.id, outwardDate: { gte: cutoff } },
    orderBy: { outwardDate: "desc", id: "desc" },
    limit: SPARES_MAX_LINES,
  })

  return rows.map((r) => ({
    outwardDate: r.outwardDate,
    partNumber: r.partNumber,
    materialName: r.materialName,
    quantity: r.quantity,
    amountUsd: r.amountUsd,
    jobCardNo: r.jobCardNo,
  }))
}

function loadPriorSessions(fleetId: string) {
  return db.query.pttDiagnosticSessionsTable.findMany({
    where: { fleetId },
    with: { faults: true },
    orderBy: { scannedAt: "desc" },
    limit: PRIOR_SESSIONS_LIMIT,
  })
}

type PriorSession = Awaited<ReturnType<typeof loadPriorSessions>>[number]

function formatSparesSummary(spares: PttSparesContextItem[]) {
  if (spares.length === 0) {
    return `No spares were issued to this truck in the last ${SPARES_WINDOW_DAYS} days (or the fleet ID is not in the assets list).`
  }
  const lines = spares.map(
    (s) =>
      `- ${s.outwardDate} | Part ${s.partNumber} | ${s.materialName} | Qty ${s.quantity} | ${s.amountUsd ? `$${s.amountUsd}` : "$ n/a"} | Job card ${s.jobCardNo}`
  )
  return `${spares.length} most recent line(s) issued in the last ${SPARES_WINDOW_DAYS} days (newest first):\n${lines.join("\n")}`
}

function formatPriorScansSummary(sessions: PriorSession[]) {
  if (sessions.length === 0) return "No prior PTT scans on file for this truck."
  return sessions
    .map((s) => {
      const header = `- Scan ${isoDate(s.scannedAt)} | ${s.truckGeneration} | status ${s.status} | overall ${s.overallSeverity}${s.odometerKm != null ? ` | ${s.odometerKm} km` : ""}`
      const faults =
        s.faults.length === 0
          ? "    (no faults recorded)"
          : s.faults
              .map(
                (f) =>
                  `    * ${f.faultCode} [${f.controlUnit}] ${f.componentDescription} | ${f.faultState} | ${f.severity}${f.resolvedOnRescan ? " | resolved on re-scan" : ""}`
              )
              .join("\n")
      const diagnosis = s.aiDirective?.true_diagnosis
        ? `\n    Previous diagnosis: ${s.aiDirective.true_diagnosis}`
        : ""
      return `${header}\n${faults}${diagnosis}`
    })
    .join("\n")
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

const SEVERITY_RANK = Object.fromEntries(
  PTT_FAULT_SEVERITIES.map((s, i) => [s, i])
) as Record<(typeof PTT_FAULT_SEVERITIES)[number], number>

// Safety net behind the prompt's dedupe rule: one row per code + control
// unit, keeping the worst severity and the highest occurrence count.
function dedupeFaults(faults: PttFault[]): PttFault[] {
  const byKey = new Map<string, PttFault>()
  for (const raw of faults) {
    const fault: PttFault = {
      ...raw,
      fault_code: raw.fault_code.trim().toUpperCase(),
      control_unit: raw.control_unit.trim(),
    }
    const key = `${fault.fault_code}|${fault.control_unit.toUpperCase()}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, fault)
      continue
    }
    const worse =
      SEVERITY_RANK[fault.severity] < SEVERITY_RANK[existing.severity]
        ? fault
        : existing
    byKey.set(key, {
      ...worse,
      occurrence_count:
        Math.max(fault.occurrence_count ?? 0, existing.occurrence_count ?? 0) ||
        worse.occurrence_count,
      calibration_required:
        fault.calibration_required || existing.calibration_required,
      fault_state:
        fault.fault_state === "ACTIVE" || existing.fault_state === "ACTIVE"
          ? "ACTIVE"
          : worse.fault_state,
    })
  }
  return [...byKey.values()]
}

function toOdometer(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Analyses a batch of already-uploaded PTT screenshots (see
// `/api/diagnostics/upload`) with OpenAI Vision, cross-checked against the
// truck's 90-day spares history and prior scans, and stores the result as a
// new diagnostic session. Blob credentials come from the Vercel OIDC
// environment (no manual `token`).
export async function POST(request: Request) {
  let userId: string
  try {
    userId = await requireAdmin()
  } catch (error) {
    if (error instanceof HrAuthError) return fail(error.message, error.status)
    throw error
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail("Expected a JSON body", 400)
  }
  const parsed = analyzeRequestSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)
  }
  const input = parsed.data

  // Screenshots must be ones this feature uploaded for this truck; otherwise
  // a caller could point us at any blob in the store.
  const prefix = pttBlobPrefix(input.fleetId)
  const badPath = input.attachments.find(
    (a) => !a.blobPathname.startsWith(prefix) || a.blobPathname.includes("..")
  )
  if (badPath) {
    return fail(`Screenshot "${badPath.fileName}" does not belong to ${input.fleetId}`, 400)
  }

  let createdSessionId: number | null = null

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new AnalyzeError("OPENAI_API_KEY is not configured on the server.", 500)
    }

    // 1-2. Spares history + prior scans.
    const [spares, priorSessions] = await Promise.all([
      loadSparesContext(input.fleetId),
      loadPriorSessions(input.fleetId),
    ])

    // 3. Read the private photos for OpenAI Vision. Server-reported blob
    // metadata (url, size, content type) is preferred over client-supplied.
    const photos = await Promise.all(
      input.attachments.map(async (att) => {
        const result = await get(att.blobPathname, { access: "private" })
        if (!result || result.statusCode !== 200) {
          throw new AnalyzeError(`Screenshot "${att.fileName}" was not found in storage`, 404)
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
        return {
          fileName: att.fileName,
          blobPathname: result.blob.pathname,
          blobUrl: result.blob.url,
          contentType,
          fileSize: result.blob.size,
          dataUrl: `data:${contentType};base64,${base64}`,
        }
      })
    )

    const userText = [
      `Fleet ID: ${input.fleetId}`,
      `Truck generation (user-selected): ${input.truckGeneration}`,
      `Odometer (user-entered): ${input.odometerKm != null ? `${input.odometerKm} km` : "not provided"}`,
      `Scan batch: ${input.scanBatchLabel ?? "n/a"}`,
      `Today: ${isoDate(new Date())}`,
      `Screenshots attached: ${photos.length} (same truck, may overlap)`,
      "",
      `WORKSHOP CONTEXT (driver complaint / what the mechanics want to replace):\n${input.workshopContext ?? "None provided."}`,
      "",
      `90-DAY SPARES HISTORY:\n${formatSparesSummary(spares)}`,
      "",
      `PRIOR PTT SCANS (most recent first):\n${formatPriorScansSummary(priorSessions)}`,
    ].join("\n")

    // Under maxDuration; fail fast rather than be killed mid-request.
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 50_000,
      maxRetries: 0,
    })
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
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
    if (!content) throw new AnalyzeError("The AI returned an empty response.", 502)

    let json: unknown
    try {
      json = JSON.parse(content)
    } catch {
      throw new AnalyzeError("The AI returned invalid JSON. Please try again.", 502)
    }
    const validated = pttAnalysisResultSchema.safeParse(json)
    if (!validated.success) {
      console.error("[ptt-analyze] schema mismatch:", validated.error.issues)
      throw new AnalyzeError(
        "The AI response did not match the expected format. Please try again.",
        502
      )
    }
    const analysis = validated.data

    // Counts and overall severity are derived here, not taken from the model.
    const faults = dedupeFaults(analysis.faults)
    const summary = summarizePttFaults(
      faults.map((f) => ({ severity: f.severity }))
    )
    const truckGeneration =
      input.truckGeneration === "UNKNOWN"
        ? analysis.detected_generation
        : input.truckGeneration
    const odometerKm = input.odometerKm ?? toOdometer(analysis.odometer_km)

    // neon-http has no interactive transactions, so: insert the session,
    // write children in one atomic batch, and on any failure delete the
    // session (children cascade) and the blobs.
    const [session] = await db
      .insert(pttDiagnosticSessionsTable)
      .values({
        fleetId: input.fleetId,
        truckGeneration,
        odometerKm,
        scanBatchLabel: input.scanBatchLabel,
        workshopContext: input.workshopContext,
        status: "SCANNED",
        ...summary,
        sparesContextSnapshot: spares,
        aiDirective: analysis.directive,
        scannedBy: userId,
      })
      .returning()
    createdSessionId = session.id

    const attachmentInsert = db
      .insert(pttSessionAttachmentsTable)
      .values(
        photos.map((p) => ({
          sessionId: session.id,
          role: "INITIAL_SCAN" as const,
          fileName: p.fileName,
          blobPathname: p.blobPathname,
          blobUrl: p.blobUrl,
          contentType: p.contentType,
          fileSize: p.fileSize,
        }))
      )
      .returning()

    let insertedFaults: (typeof pttFaultCodesTable.$inferSelect)[] = []
    let insertedAttachments: (typeof pttSessionAttachmentsTable.$inferSelect)[]
    if (faults.length > 0) {
      const faultInsert = db
        .insert(pttFaultCodesTable)
        .values(
          faults.map((f) => ({
            sessionId: session.id,
            fleetId: input.fleetId,
            faultCode: f.fault_code,
            codeFormat: f.code_format,
            controlUnit: f.control_unit,
            componentDescription: f.component_description,
            faultState: f.fault_state,
            occurrenceCount:
              f.occurrence_count == null
                ? null
                : Math.max(0, Math.round(f.occurrence_count)),
            severity: f.severity,
            rootCauseSummary: f.root_cause_summary,
            calibrationRequired: f.calibration_required,
          }))
        )
        .returning()
      ;[insertedFaults, insertedAttachments] = await db.batch([
        faultInsert,
        attachmentInsert,
      ])
    } else {
      ;[insertedAttachments] = await db.batch([attachmentInsert])
    }

    revalidatePath("/diagnostics")
    return NextResponse.json({
      success: true,
      data: {
        ...session,
        faults: insertedFaults,
        attachments: insertedAttachments,
      },
    })
  } catch (error) {
    console.error("[ptt-analyze] analysis failed:", error)

    // Roll back: no session row and no orphaned screenshots.
    if (createdSessionId !== null) {
      await db
        .delete(pttDiagnosticSessionsTable)
        .where(eq(pttDiagnosticSessionsTable.id, createdSessionId))
        .catch((cleanupError) =>
          console.error("[ptt-analyze] session rollback failed:", cleanupError)
        )
    }
    await del(input.attachments.map((a) => a.blobPathname)).catch(
      (cleanupError) =>
        console.error("[ptt-analyze] blob cleanup failed:", cleanupError)
    )

    if (error instanceof AnalyzeError) return fail(error.message, error.status)
    return fail("Analysis failed. Please try again.", 500)
  }
}
