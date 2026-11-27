import "server-only"

import { get } from "@vercel/blob"
import { createHash } from "node:crypto"
import OpenAI from "openai"
import { z } from "zod"

import {
  PTT_CODE_FORMATS,
  PTT_FAULT_STATES,
  PTT_IMAGE_CONTENT_TYPES,
  PTT_IMAGE_MAX_BYTES,
  PTT_TRUCK_GENERATIONS,
  pttRawOcrSchema,
  type PttRawOcr,
  type PttTruckGeneration,
} from "@/lib/ptt-diagnostics"

// Pass 1 (exhaustive verbatim vision OCR) of the PTT pipeline, shared by the
// baseline route (/api/diagnostics/analyze) and the post-work verification
// route (/api/diagnostics/sessions/[id]/verification). Server-only.

export const OCR_TIMEOUT_MS = 22_000
// Pass 1 only transcribes rows, so trucks with 30-40 faults fit in this cap.
export const OCR_MAX_COMPLETION_TOKENS = 4096

// Expected, user-facing failure with the HTTP status to answer with. Extra
// `code` / `details` let the UI react to a specific gate.
export class PttPipelineError extends Error {
  readonly status: number
  readonly code: string | null
  readonly details: Record<string, unknown> | null
  constructor(
    message: string,
    status = 400,
    code: string | null = null,
    details: Record<string, unknown> | null = null
  ) {
    super(message)
    this.name = "PttPipelineError"
    this.status = status
    this.code = code
    this.details = details
  }
}

export const pttUploadedAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  blobPathname: z.string().trim().min(1).max(1024),
  blobUrl: z.string().trim().min(1).max(2048),
  contentType: z.enum(PTT_IMAGE_CONTENT_TYPES),
  fileSize: z.number().int().positive().max(PTT_IMAGE_MAX_BYTES),
})
export type PttUploadedAttachment = z.infer<typeof pttUploadedAttachmentSchema>

export type LoadedPhoto = {
  fileName: string
  blobPathname: string
  blobUrl: string
  contentType: string
  fileSize: number
  dataUrl: string
  /** SHA-256 (hex) of the file bytes, used to catch recycled screenshots. */
  sha256: string
}

// Reads the private photos for OpenAI Vision and hashes them. Server-reported
// blob metadata (url, size, content type) is preferred over client-supplied.
export async function loadPhotos(
  attachments: readonly PttUploadedAttachment[]
): Promise<LoadedPhoto[]> {
  return Promise.all(
    attachments.map(async (att) => {
      const result = await get(att.blobPathname, { access: "private" })
      if (!result || result.statusCode !== 200) {
        throw new PttPipelineError(
          `Screenshot "${att.fileName}" was not found in storage`,
          404
        )
      }
      const bytes = Buffer.from(await new Response(result.stream).arrayBuffer())
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
        dataUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }
    })
  )
}

// ---------------------------------------------------------------------------
// Pass 1 system prompt: exhaustive verbatim vision OCR
// ---------------------------------------------------------------------------

const OCR_SYSTEM_PROMPT = `You are a pure verbatim OCR table transcriber for Volvo Premium Tech Tool (PTT) and VCADS Pro screens. Your ONLY job is to copy what is printed on screen into JSON. Do NOT diagnose, summarize, interpret, skip rows, or rename ECUs.

The screenshots show the SAME truck. They are often photos of a laptop screen and may be overlapping, scrolled captures of the same "DTC List", so the same row can appear in several images (transcribe it each time it is visible; duplicates are removed later).

STRICT RULES
1. Scan EVERY uploaded image from the top row to the bottom row. If "DTC List (N items)" is visible at the top of a screen, make sure you transcribe every distinct visible row across all images and put N in reported_dtc_list_count. NEVER stop after 5 rows and NEVER take a "sample". A dense screen can hold 20+ rows of small text - read all of them.
2. Copy control_unit_verbatim EXACTLY as printed on screen, preserving the MID number, e.g. "ECC ECU (MID 146)", "Engine ECU (MID 128)", "Gearbox ECU (MID 130)", "Retarder ECU (MID 222)", "Vehicle ECU (MID 144)". NEVER rewrite "ECC ECU" as "EECU" and NEVER invent "VMCU" on an FH V3 truck. If a unit heading is shared by several rows below it, repeat that heading on every row.
3. Copy every fault code verbatim into fault_code_verbatim ("MID / PID / PPID / SID / PSID + FMI" on FH V3, e.g. "PID 37 FMI 1" or "SID 11 FMI 5" under its unit; UDS hex codes such as "U300054" on FH V4), plus description_verbatim exactly as printed, the right-edge status as fault_state ("ACTIVE" / "INACTIVE", or "UNKNOWN" when it is not visible or unreadable) and occurrence_count (number, or null if not visible).
   code_format: "V3_MID_FMI" for MID/PID/SID/PSID + FMI codes, "V4_UDS" for UDS hex codes, "OTHER" for anything else.
4. If a screenshot is a VCADS Pro operation / calibration pop-up (e.g. "VCADS Pro - Operations: 37 - Gearbox input shaft speed constant"), record it in vcads_popups: operation_code (the operation number as printed, e.g. "37"), target_system (the system the operation runs against, e.g. "Gearbox"; "VCADS" if unclear), message (the exact pop-up wording including any failure reason) and background_context (what is visible behind the pop-up, e.g. the operation list or DTC screen).
5. Never guess or invent unreadable text. If a row's code cannot be read at all, skip that row; if only the state or count is unreadable use "UNKNOWN" / null.
6. Status bar and header (read these on EVERY screenshot where they are visible; use the clearest reading, else null):
   - reported_dtc_list_count: the N printed in the "DTC List (N Items)" heading (an integer), else null. Do NOT count rows yourself for this field.
   - chassis_id_ocr: the chassis / vehicle identification text in the PTT bottom status bar (chassis series + number, e.g. "A 123456"), copied exactly, else null.
   - work_order_ocr: the work order text in the PTT bottom status bar, copied exactly (it often contains the fleet number such as "MTL41"), else null.
   - product_time_ocr: the date / time printed in the PTT top-right corner ("Product Time"), copied exactly as printed, else null.
   - selected_footer_text: the BOLD fault title in the bottom-left panel directly above the "View DTC information" link (the currently selected row's title), copied exactly, else null. It is used only to confirm that row 1 you transcribed is the true top of the list.
7. detected_generation: "FH_V3" when codes are MID/PID/SID/PSID + FMI, "FH_V4" when they are UDS hex codes, otherwise "UNKNOWN". odometer_km: only if an odometer / mileage value is visible on screen, else null.
8. ROW-BY-ROW HORIZONTAL SCAN. Read strictly LEFT-TO-RIGHT across ONE horizontal row (Control Unit -> DTC -> Status) before moving down to the next row. NEVER pair a Control Unit from one row with a DTC from an adjacent row. When the rows are dense, follow the row's own baseline with your eye; a code belongs to the Control Unit on the SAME line only.
9. LITERAL DIGIT TRANSCRIPTION. Transcribe every MID, PID, PPID, SID, PSID and FMI number and every FH V4 7-character DTC (one of P / C / B / U followed by 6 hex characters) EXACTLY as printed, digit for digit. NEVER pad, extend or "complete" a code: a 2-digit code stays 2 digits (never turn "PSID 23" into "PSID 223" or "PSID 39" into "PSID 230"), a 3-digit code stays 3 digits. If a digit is genuinely unreadable, treat the code as unreadable (rule 5) instead of guessing.
10. ZERO DIAGNOSIS. Do NOT assign a severity, guess a cause, merge rows, drop a row because it looks unimportant, or omit INACTIVE rows. Transcribe EVERY visible row verbatim (ACTIVE and INACTIVE alike, including repeats across overlapping screenshots); deduplication happens deterministically in code afterwards.
11. NEVER INVENT A CONTROL UNIT. control_unit_verbatim must be ONLY the Volvo control unit text printed in the LEFT-HAND "Control Unit" column of that row, e.g. "Engine ECU (MID 128)", "Light Control Module (LCM) (MID 216)", "Vehicle ECU (MID 144)", "Retarder ECU (MID 222)". NEVER derive, guess or fabricate an ECU name from the fault description or the fault code. NEVER output synthetic names such as "Brake Lamp ECU", "Fog Lamp ECU", "Campaign Lights ECU", "Reverse Lights ECU", "Compressor Control ECU", "Regeneration Control ECU", "Rear Load Sensor ECU" or "Unknown ECU". If the left-hand Control Unit column is partially or fully cropped off the edge of the photo for a row, output "" (an empty string) or ONLY the exact characters that are visible (e.g. "(MID 216)"); a deterministic normaliser resolves it afterwards. An empty control_unit_verbatim is always better than an invented one.

OUTPUT
Return ONLY one strict JSON object (no markdown) with exactly these keys:
{
  "detected_generation": "FH_V3" | "FH_V4" | "UNKNOWN",
  "odometer_km": number | null,
  "reported_dtc_list_count": number | null,
  "chassis_id_ocr": string | null,
  "work_order_ocr": string | null,
  "product_time_ocr": string | null,
  "selected_footer_text": string | null,
  "raw_rows": [
    {
      "control_unit_verbatim": string,
      "fault_code_verbatim": string,
      "code_format": "V3_MID_FMI" | "V4_UDS" | "OTHER",
      "description_verbatim": string,
      "fault_state": "ACTIVE" | "INACTIVE" | "UNKNOWN",
      "occurrence_count": number | null
    }
  ],
  "vcads_popups": [
    { "operation_code": string, "target_system": string, "message": string, "background_context": string }
  ]
}`

// Hand-written JSON Schema for Pass 1, used with OpenAI Structured Outputs
// (`strict: true`). Deliberately NOT derived from Zod so a Zod v3/v4 SDK
// mismatch can never break it. Strict-mode rules: every object has
// `additionalProperties: false` and lists ALL its keys in `required`;
// optional values are nullable types; the unsupported keywords (pattern,
// min/maxLength, min/maxItems, minimum, maximum, default) are not used. Enums
// mirror src/lib/ptt-diagnostics.ts; `pttRawOcrSchema` re-validates the output.
export const PASS1_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "detected_generation",
    "odometer_km",
    "reported_dtc_list_count",
    "chassis_id_ocr",
    "work_order_ocr",
    "product_time_ocr",
    "selected_footer_text",
    "raw_rows",
    "vcads_popups",
  ],
  properties: {
    detected_generation: { type: "string", enum: [...PTT_TRUCK_GENERATIONS] },
    odometer_km: { type: ["number", "null"] },
    reported_dtc_list_count: { type: ["integer", "null"] },
    chassis_id_ocr: { type: ["string", "null"] },
    work_order_ocr: { type: ["string", "null"] },
    product_time_ocr: { type: ["string", "null"] },
    selected_footer_text: { type: ["string", "null"] },
    raw_rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "control_unit_verbatim",
          "fault_code_verbatim",
          "code_format",
          "description_verbatim",
          "fault_state",
          "occurrence_count",
        ],
        properties: {
          control_unit_verbatim: { type: "string" },
          fault_code_verbatim: { type: "string" },
          code_format: { type: "string", enum: [...PTT_CODE_FORMATS] },
          description_verbatim: { type: "string" },
          fault_state: { type: "string", enum: [...PTT_FAULT_STATES] },
          occurrence_count: { type: ["integer", "null"] },
        },
      },
    },
    vcads_popups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "operation_code",
          "target_system",
          "message",
          "background_context",
        ],
        properties: {
          operation_code: { type: "string" },
          target_system: { type: "string" },
          message: { type: "string" },
          background_context: { type: "string" },
        },
      },
    },
  },
} as const

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming

// "directive.true_diagnosis: Invalid input: expected string, received undefined"
function formatZodIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map(
    (issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`
  )
}

// Runs one JSON completion and validates it. Both passes use a hard per-call
// timeout and no retries so two calls always fit in `maxDuration`.
export async function runJsonPass<S extends z.ZodType>(
  openai: OpenAI,
  label: string,
  schema: S,
  params: ChatParams,
  timeoutMs: number
): Promise<z.output<S>> {
  let response: OpenAI.Chat.Completions.ChatCompletion
  try {
    response = await openai.chat.completions.create(params, {
      timeout: timeoutMs,
      maxRetries: 0,
    })
  } catch (error) {
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      throw new PttPipelineError(
        `${label} timed out after ${timeoutMs / 1000}s. Try again, or upload fewer screenshots per scan.`,
        504
      )
    }
    throw error
  }

  const choice = response.choices[0]
  if (choice?.finish_reason === "length") {
    throw new PttPipelineError(
      `${label} output was too long and got cut off. Split the screenshots into smaller batches and scan again.`,
      502
    )
  }
  if (choice?.message?.refusal) {
    console.error(`[ptt-analyze] ${label} refusal:`, choice.message.refusal)
    throw new PttPipelineError(
      `${label} was refused by the model: ${choice.message.refusal}`,
      502
    )
  }
  const content = choice?.message?.content
  if (!content) throw new PttPipelineError(`${label} returned an empty response.`, 502)

  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    throw new PttPipelineError(`${label} returned invalid JSON. Please try again.`, 502)
  }
  const validated = schema.safeParse(json)
  if (!validated.success) {
    const issues = formatZodIssues(validated.error.issues)
    console.error(
      `[ptt-analyze] ${label} schema mismatch (${issues.length} issue(s)):\n${issues.join("\n")}`
    )
    // Admin-only route: surface the first 2 failing paths to avoid blind debugging.
    throw new PttPipelineError(
      `${label} did not match the expected format (${issues.slice(0, 2).join("; ")}). Please try again.`,
      502
    )
  }
  return validated.data
}


export type PttOcrResult = PttRawOcr & {
  /** Blank OCR strings normalised to null. */
  chassis_id_ocr: string | null
  work_order_ocr: string | null
  product_time_ocr: string | null
  selected_footer_text: string | null
}

const blankToNull = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? ""
  return trimmed === "" ? null : trimmed
}

// Runs Pass 1 over the photos of one truck and validates / normalises it.
export async function runVisionOcr(options: {
  openai: OpenAI
  model: string
  fleetId: string
  truckGeneration: PttTruckGeneration
  photos: readonly LoadedPhoto[]
}): Promise<PttOcrResult> {
  const { openai, model, fleetId, truckGeneration, photos } = options
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: [
        `Fleet ID: ${fleetId}`,
        `Truck generation (user-selected): ${truckGeneration}`,
        `Screenshots attached: ${photos.length} (same truck, may overlap). Transcribe EVERY row of EVERY screenshot.`,
      ].join("\n"),
    },
  ]
  photos.forEach((photo, index) => {
    content.push(
      { type: "text", text: `Screenshot ${index + 1} of ${photos.length}:` },
      { type: "image_url", image_url: { url: photo.dataUrl, detail: "high" } }
    )
  })

  const ocr = await runJsonPass(
    openai,
    "Screenshot transcription",
    pttRawOcrSchema,
    {
      model,
      temperature: 0,
      max_tokens: OCR_MAX_COMPLETION_TOKENS,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ptt_ocr_transcription",
          strict: true,
          schema: PASS1_JSON_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: OCR_SYSTEM_PROMPT },
        { role: "user", content },
      ],
    },
    OCR_TIMEOUT_MS
  )

  return {
    ...ocr,
    chassis_id_ocr: blankToNull(ocr.chassis_id_ocr),
    work_order_ocr: blankToNull(ocr.work_order_ocr),
    product_time_ocr: blankToNull(ocr.product_time_ocr),
    selected_footer_text: blankToNull(ocr.selected_footer_text),
  }
}
