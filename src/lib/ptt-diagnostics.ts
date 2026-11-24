import { z } from "zod"

// Client-safe constants, Zod schemas and helpers for the Fleet Diagnostics
// (PTT Intel) module. Lives here (not in src/db/schema.ts) so Client
// Components can import it without pulling the Drizzle schema into the
// browser bundle. The DB columns are plain text; Zod enforces these values
// in the Server Actions. Do NOT import `@/db/schema` from this file.

export const PTT_TRUCK_GENERATIONS = ["FH_V3", "FH_V4", "UNKNOWN"] as const
export type PttTruckGeneration = (typeof PTT_TRUCK_GENERATIONS)[number]

export const PTT_SESSION_STATUSES = [
  "SCANNED",
  "DIRECTIVE_ISSUED",
  "IN_PROGRESS",
  "VERIFIED_CLOSED",
] as const
export type PttSessionStatus = (typeof PTT_SESSION_STATUSES)[number]

export const PTT_FAULT_SEVERITIES = [
  "CRITICAL",
  "CALIBRATION_ONLY",
  "MONITOR",
  "NEGLIGIBLE",
] as const
export type PttFaultSeverity = (typeof PTT_FAULT_SEVERITIES)[number]

// A session's overall severity is the worst fault severity, or `CLEAR` when
// the scan contained no faults at all.
export const PTT_OVERALL_SEVERITIES = [...PTT_FAULT_SEVERITIES, "CLEAR"] as const
export type PttOverallSeverity = (typeof PTT_OVERALL_SEVERITIES)[number]

export const PTT_FAULT_STATES = ["ACTIVE", "INACTIVE", "UNKNOWN"] as const
export type PttFaultState = (typeof PTT_FAULT_STATES)[number]

export const PTT_ATTACHMENT_ROLES = ["INITIAL_SCAN", "VERIFICATION_SCAN"] as const
export type PttAttachmentRole = (typeof PTT_ATTACHMENT_ROLES)[number]

export const PTT_CODE_FORMATS = ["V3_MID_FMI", "V4_UDS", "OTHER"] as const
export type PttCodeFormat = (typeof PTT_CODE_FORMATS)[number]

// ---------------------------------------------------------------------------
// AI diagnostic output
// ---------------------------------------------------------------------------

export const pttFaultSchema = z.object({
  fault_code: z.string(),
  code_format: z.enum(PTT_CODE_FORMATS),
  control_unit: z.string(),
  component_description: z.string(),
  fault_state: z.enum(PTT_FAULT_STATES),
  occurrence_count: z.number().nullable(),
  severity: z.enum(PTT_FAULT_SEVERITIES),
  root_cause_summary: z.string(),
  calibration_required: z.boolean(),
})

export type PttFault = z.infer<typeof pttFaultSchema>

export const pttDirectiveSchema = z.object({
  evidence_analysis: z.string(),
  parts_cannon_warning: z.string(),
  true_diagnosis: z.string(),
  physical_inspections: z.array(z.string()),
  ptt_navigation_paths: z.array(z.string()),
  verification_criteria: z.array(z.string()),
})

export type PttDirective = z.infer<typeof pttDirectiveSchema>

export const pttAnalysisResultSchema = z.object({
  detected_generation: z.enum(PTT_TRUCK_GENERATIONS),
  odometer_km: z.number().nullable(),
  overall_severity: z.enum(PTT_OVERALL_SEVERITIES),
  faults: z.array(pttFaultSchema),
  directive: pttDirectiveSchema,
})

export type PttAnalysisResult = z.infer<typeof pttAnalysisResultSchema>

// Before/After re-scan result stored in
// `ptt_diagnostic_sessions.verification_summary`.
export const pttVerificationSummarySchema = z.object({
  verdict: z.enum(["RESOLVED", "PARTIALLY_RESOLVED", "NOT_RESOLVED"]),
  resolved_fault_codes: z.array(z.string()),
  remaining_fault_codes: z.array(z.string()),
  new_fault_codes: z.array(z.string()),
  summary: z.string(),
})

export type PttVerificationSummary = z.infer<
  typeof pttVerificationSummarySchema
>

// Snapshot of the 90-day spares history passed to OpenAI as context. Field
// names mirror `mechanicalSparesTable` (src/db/schema.ts): `outwardDate`
// (date -> 'YYYY-MM-DD'), `partNumber`, `materialName` (the ERP part
// description), `quantity` (numeric -> string), `amountUsd` (the line's
// "Amount ($)", null when the ERP left it blank) and `jobCardNo`. The truck
// itself is implied by the session's `fleetId` (`assetsTable.assetName`).
export type PttSparesContextItem = {
  outwardDate: string
  partNumber: string
  materialName: string
  quantity: string
  amountUsd: string | null
  jobCardNo: string
}

// ---------------------------------------------------------------------------
// Screenshot upload rules (shared by the upload route and the client uploader)
// ---------------------------------------------------------------------------

export const PTT_IMAGE_MAX_BYTES = 4.5 * 1024 * 1024

// Extension -> the only MIME types accepted for it.
export const PTT_IMAGE_TYPES = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
} as const satisfies Record<string, readonly string[]>

export const PTT_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const

// Canonical fleet number: trimmed + uppercase (e.g. ` mtl61 ` -> `MTL61`).
export function normalizeFleetId(value: string): string {
  return value.trim().toUpperCase()
}

// ---------------------------------------------------------------------------
// Deterministic severity roll-up
// ---------------------------------------------------------------------------

export type PttFaultSummary = {
  criticalCount: number
  calibrationCount: number
  monitorCount: number
  negligibleCount: number
  overallSeverity: PttOverallSeverity
}

// Counts per tier and the worst tier present (CRITICAL > CALIBRATION_ONLY >
// MONITOR > NEGLIGIBLE > CLEAR), computed from the validated faults rather
// than trusting the model's own arithmetic.
export function summarizePttFaults(
  faults: ReadonlyArray<{ severity: PttFaultSeverity }>
): PttFaultSummary {
  const count = (tier: PttFaultSeverity) =>
    faults.filter((f) => f.severity === tier).length
  const criticalCount = count("CRITICAL")
  const calibrationCount = count("CALIBRATION_ONLY")
  const monitorCount = count("MONITOR")
  const negligibleCount = count("NEGLIGIBLE")

  const overallSeverity: PttOverallSeverity =
    criticalCount > 0
      ? "CRITICAL"
      : calibrationCount > 0
        ? "CALIBRATION_ONLY"
        : monitorCount > 0
          ? "MONITOR"
          : negligibleCount > 0
            ? "NEGLIGIBLE"
            : "CLEAR"

  return {
    criticalCount,
    calibrationCount,
    monitorCount,
    negligibleCount,
    overallSeverity,
  }
}

// ---------------------------------------------------------------------------
// WhatsApp directive formatting
// ---------------------------------------------------------------------------

// Minimal structural shape needed to build the message, so it works with a
// DB row (`aiDirective` is jsonb, hence nullable) as well as a fresh
// `PttAnalysisResult`-derived object.
export type PttDirectiveSessionInput = {
  fleetId: string
  truckGeneration: string
  overallSeverity: string
  aiDirective: PttDirective | null
  faults?: ReadonlyArray<
    Pick<
      PttFaultRow,
      "faultCode" | "controlUnit" | "componentDescription" | "severity"
    >
  >
}

type PttFaultRow = {
  faultCode: string
  controlUnit: string
  componentDescription: string
  severity: string
}

const GENERATION_LABELS: Record<string, string> = {
  FH_V3: "Volvo FH V3",
  FH_V4: "Volvo FH V4",
  UNKNOWN: "Unknown",
}

const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "🔴 CRITICAL",
  CALIBRATION_ONLY: "🟠 CALIBRATION ONLY",
  MONITOR: "🟡 MONITOR",
  NEGLIGIBLE: "⚪ NEGLIGIBLE",
  CLEAR: "🟢 CLEAR",
}

function bulletList(items: readonly string[], numbered = false): string {
  return items
    .map((item, i) => `${numbered ? `${i + 1}.` : "•"} ${item.trim()}`)
    .join("\n")
}

/**
 * Formats a crisp WhatsApp-markdown directive for the Workshop Manager
 * (`*bold*`, `_italic_`). Includes Fleet ID, generation, overall status,
 * critical & calibration fault codes, the parts-cannon warning, physical
 * checks, PTT navigation paths and verification criteria.
 */
export function formatPttDirectiveForWhatsApp(
  session: PttDirectiveSessionInput
): string {
  const directive = session.aiDirective
  const lines: string[] = []

  lines.push(`*🔧 PTT DIAGNOSTIC DIRECTIVE*`)
  lines.push(`*Fleet ID:* ${session.fleetId}`)
  lines.push(
    `*Generation:* ${GENERATION_LABELS[session.truckGeneration] ?? session.truckGeneration}`
  )
  lines.push(
    `*Overall Status:* ${SEVERITY_LABELS[session.overallSeverity] ?? session.overallSeverity}`
  )

  const keyFaults = (session.faults ?? []).filter(
    (f) => f.severity === "CRITICAL" || f.severity === "CALIBRATION_ONLY"
  )
  if (keyFaults.length > 0) {
    lines.push("")
    lines.push(`*Critical & Calibration Faults:*`)
    for (const f of keyFaults) {
      const tag = f.severity === "CRITICAL" ? "🔴" : "🟠"
      lines.push(
        `${tag} \`${f.faultCode}\` – ${f.controlUnit}: ${f.componentDescription}`
      )
    }
  }

  if (!directive) {
    return lines.join("\n")
  }

  if (directive.true_diagnosis.trim()) {
    lines.push("")
    lines.push(`*True Diagnosis:*`)
    lines.push(directive.true_diagnosis.trim())
  }

  if (directive.parts_cannon_warning.trim()) {
    lines.push("")
    lines.push(`*⚠️ Parts-Cannon Warning:*`)
    lines.push(directive.parts_cannon_warning.trim())
  }

  if (directive.physical_inspections.length > 0) {
    lines.push("")
    lines.push(`*Physical Checks:*`)
    lines.push(bulletList(directive.physical_inspections, true))
  }

  if (directive.ptt_navigation_paths.length > 0) {
    lines.push("")
    lines.push(`*PTT Paths:*`)
    lines.push(bulletList(directive.ptt_navigation_paths))
  }

  if (directive.verification_criteria.length > 0) {
    lines.push("")
    lines.push(`*Verification Criteria:*`)
    lines.push(bulletList(directive.verification_criteria))
  }

  return lines.join("\n")
}
