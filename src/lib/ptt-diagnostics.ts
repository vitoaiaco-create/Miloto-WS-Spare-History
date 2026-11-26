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
  // Pass 2 echoes the Pass 1 row number (`#n`) it classified, so the server
  // can prove every extracted row was kept. `null` for VCADS pop-up entries.
  // Never persisted.
  source_row: z.number().int().nullish(),
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

// ---------------------------------------------------------------------------
// Pass 1 (verbatim vision OCR) output
// ---------------------------------------------------------------------------

// Defense-in-depth behind OpenAI Structured Outputs (which already pins the
// exact enum values): normalises a model-produced enum string (trim, uppercase,
// whitespace / hyphens -> "_") so Title Case values like "Active" still match,
// and falls back to `fallback` for any other unexpected string. Non-string
// values are passed through untouched so Zod still reports them.
function caseInsensitiveEnum<const T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number]
) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value
    const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_")
    return (values as readonly string[]).includes(normalized)
      ? normalized
      : fallback
  }, z.enum(values))
}

export const pttRawRowSchema = z.object({
  control_unit_verbatim: z.string(),
  fault_code_verbatim: z.string(),
  code_format: caseInsensitiveEnum(PTT_CODE_FORMATS, "OTHER"),
  description_verbatim: z.string(),
  fault_state: caseInsensitiveEnum(PTT_FAULT_STATES, "UNKNOWN"),
  occurrence_count: z.number().nullable().default(null),
})

export const pttVcadsPopupSchema = z.object({
  operation_code: z.string(),
  target_system: z.string(),
  message: z.string(),
  background_context: z.string(),
})

export const pttRawOcrSchema = z.object({
  detected_generation: caseInsensitiveEnum(PTT_TRUCK_GENERATIONS, "UNKNOWN"),
  odometer_km: z.number().nullable().default(null),
  // N from the "DTC List (N Items)" heading (`headerItemCount`).
  reported_dtc_list_count: z.number().nullable().default(null),
  // PTT bottom status bar / top-right timestamp, as printed.
  chassis_id_ocr: z.string().nullable().default(null),
  work_order_ocr: z.string().nullable().default(null),
  product_time_ocr: z.string().nullable().default(null),
  // Bold fault title in the bottom-left panel above "View DTC information"
  // (the selected row). Used to confirm row 1 is the true top of the list.
  selected_footer_text: z.string().nullable().default(null),
  raw_rows: z.array(pttRawRowSchema),
  vcads_popups: z.array(pttVcadsPopupSchema).default([]),
})

export type PttRawRow = z.infer<typeof pttRawRowSchema>
export type PttVcadsPopup = z.infer<typeof pttVcadsPopupSchema>
export type PttRawOcr = z.infer<typeof pttRawOcrSchema>

// Before/After re-scan result stored in
// `ptt_diagnostic_sessions.verification_summary`.
export const pttVerificationSummarySchema = z.object({
  verification_passed: z.boolean(),
  summary: z.string(),
  resolved_fault_codes: z.array(z.string()),
  still_active_fault_codes: z.array(z.string()),
  newly_introduced_fault_codes: z.array(z.string()),
  next_enforcement_action: z.string(),
  verified_by_model: z.string().optional(),
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

const FLEET_ID_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
})

// Natural fleet-number comparator: `MTL2` < `MTL10` < `MTL140`.
export function compareFleetIds(a: string, b: string): number {
  return FLEET_ID_COLLATOR.compare(a, b)
}

// Higher = worse. Used to rank faults and pick a truck's/fault group's
// highest severity.
export const PTT_SEVERITY_RANK: Record<PttOverallSeverity, number> = {
  CRITICAL: 4,
  CALIBRATION_ONLY: 3,
  MONITOR: 2,
  NEGLIGIBLE: 1,
  CLEAR: 0,
}

type PttLatestSessionKey = { id: number; fleetId: string; scannedAt: Date }

// Picks each truck's most recent session (newest `scannedAt`, ties broken by
// the higher `id`), keyed by normalized fleet id. Works on unsorted input.
export function latestSessionByFleet<T extends PttLatestSessionKey>(
  sessions: readonly T[]
): Map<string, T> {
  const latest = new Map<string, T>()
  for (const session of sessions) {
    const fleetId = normalizeFleetId(session.fleetId)
    const current = latest.get(fleetId)
    if (
      !current ||
      session.scannedAt.getTime() > current.scannedAt.getTime() ||
      (session.scannedAt.getTime() === current.scannedAt.getTime() &&
        session.id > current.id)
    ) {
      latest.set(fleetId, session)
    }
  }
  return latest
}

// Total scans per truck, keyed by normalized fleet id.
export function countSessionsByFleet(
  sessions: ReadonlyArray<{ fleetId: string }>
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const fleetId = normalizeFleetId(session.fleetId)
    counts.set(fleetId, (counts.get(fleetId) ?? 0) + 1)
  }
  return counts
}

// A directive is "open" while the truck's latest scan still has something to
// act on: not closed out, and not a clear / negligible-only result.
export function isOpenDirective(session: {
  status: string
  overallSeverity: string
}): boolean {
  return (
    session.status !== "VERIFIED_CLOSED" &&
    session.overallSeverity !== "CLEAR" &&
    session.overallSeverity !== "NEGLIGIBLE"
  )
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
  // Stored tier counts, used for the "Faults Extracted" line when the fault
  // rows themselves are not supplied.
  criticalCount?: number
  calibrationCount?: number
  monitorCount?: number
  negligibleCount?: number
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
  CALIBRATION_ONLY: "🟣 CALIBRATION ONLY",
  MONITOR: "🟠 MONITOR",
  NEGLIGIBLE: "⚪ NEGLIGIBLE",
  CLEAR: "🟢 CLEAR",
}

// "*Faults Extracted:* 20 total (🔴 6 Critical | 🟣 0 Calibration | 🟠 14
// Monitor | ⚪ 0 Negligible)". Counts come from the fault rows when supplied,
// else from the stored tier counts; `null` when neither is available.
function faultBreakdownLine(session: PttDirectiveSessionInput): string | null {
  let counts: Omit<PttFaultSummary, "overallSeverity"> | null = null
  if (session.faults) {
    const count = (tier: PttFaultSeverity) =>
      session.faults!.filter((f) => f.severity === tier).length
    counts = {
      criticalCount: count("CRITICAL"),
      calibrationCount: count("CALIBRATION_ONLY"),
      monitorCount: count("MONITOR"),
      negligibleCount: count("NEGLIGIBLE"),
    }
  } else if (
    session.criticalCount != null &&
    session.calibrationCount != null &&
    session.monitorCount != null &&
    session.negligibleCount != null
  ) {
    counts = {
      criticalCount: session.criticalCount,
      calibrationCount: session.calibrationCount,
      monitorCount: session.monitorCount,
      negligibleCount: session.negligibleCount,
    }
  }
  if (!counts) return null

  const total =
    counts.criticalCount +
    counts.calibrationCount +
    counts.monitorCount +
    counts.negligibleCount
  return `*Faults Extracted:* ${total} total (🔴 ${counts.criticalCount} Critical | 🟣 ${counts.calibrationCount} Calibration | 🟠 ${counts.monitorCount} Monitor | ⚪ ${counts.negligibleCount} Negligible)`
}

function bulletList(items: readonly string[], numbered = false): string {
  return items
    .map((item, i) => `${numbered ? `${i + 1}.` : "•"} ${item.trim()}`)
    .join("\n")
}

/**
 * Formats a crisp WhatsApp-markdown directive for the Workshop Manager
 * (`*bold*`, `_italic_`). Includes Fleet ID, generation, overall status,
 * critical & calibration fault codes, the parts warning, physical
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
  const breakdown = faultBreakdownLine(session)
  if (breakdown) lines.push(breakdown)

  // Only the two actionable tiers are listed individually; the breakdown line
  // above covers Monitor / Negligible so the message stays mobile-readable.
  const keyFaults = (session.faults ?? []).filter(
    (f) => f.severity === "CRITICAL" || f.severity === "CALIBRATION_ONLY"
  )
  if (keyFaults.length > 0) {
    lines.push("")
    lines.push(`*Critical & Calibration Faults:*`)
    for (const f of keyFaults) {
      const tag = f.severity === "CRITICAL" ? "🔴" : "🟣"
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
    lines.push(`*⚠️ Parts Warning:*`)
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

// ---------------------------------------------------------------------------
// WhatsApp verification verdict formatting
// ---------------------------------------------------------------------------

export type PttVerificationSessionInput = {
  fleetId: string
  verificationSummary: PttVerificationSummary | null
}

function codeSection(
  lines: string[],
  title: string,
  tag: string,
  codes: readonly string[]
) {
  if (codes.length === 0) return
  lines.push("")
  lines.push(`*${title}:*`)
  for (const code of codes) lines.push(`${tag} \`${code.trim()}\``)
}

/**
 * Formats a concise WhatsApp verdict for a Before/After re-scan: the
 * pass / fail banner, resolved, still-active and newly introduced codes and
 * the next enforcement order. Returns a "no verification yet" line when the
 * session has not been verified.
 */
export function formatPttVerificationForWhatsApp(
  session: PttVerificationSessionInput
): string {
  const verification = session.verificationSummary
  if (!verification) {
    return `*🔍 PTT RE-SCAN VERIFICATION*\n*Fleet ID:* ${session.fleetId}\nNo verification re-scan has been run yet.`
  }

  const lines: string[] = []
  lines.push(`*🔍 PTT RE-SCAN VERIFICATION*`)
  lines.push(`*Fleet ID:* ${session.fleetId}`)
  lines.push(
    verification.verification_passed
      ? `*✅ VERIFIED PASSED*`
      : `*⛔ VERIFICATION FAILED — REWORK REQUIRED*`
  )

  if (verification.summary.trim()) {
    lines.push("")
    lines.push(verification.summary.trim())
  }

  codeSection(lines, "Resolved Codes", "✅", verification.resolved_fault_codes)
  codeSection(
    lines,
    "Still Active Codes",
    "🔴",
    verification.still_active_fault_codes
  )
  codeSection(
    lines,
    "Newly Introduced Codes",
    "🟠",
    verification.newly_introduced_fault_codes
  )

  if (verification.next_enforcement_action.trim()) {
    lines.push("")
    lines.push(`*Next Enforcement Order:*`)
    lines.push(verification.next_enforcement_action.trim())
  }

  return lines.join("\n")
}
