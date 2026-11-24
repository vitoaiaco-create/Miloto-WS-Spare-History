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
  pttRawOcrSchema,
  summarizePttFaults,
  type PttFault,
  type PttSparesContextItem,
} from "@/lib/ptt-diagnostics"
import {
  clampCabClimateSeverity,
  dedupeAndNumberRawRows,
  dedupeVcadsPopups,
  fallbackFaultFromPopup,
  fallbackFaultFromRow,
  findUncoveredPopups,
  findUncoveredRows,
  formatNumberedFaultList,
  formatVcadsPopupList,
} from "@/lib/ptt-ocr-pipeline"
import { pttBlobPrefix } from "@/lib/ptt-files"

// Two sequential OpenAI passes (vision OCR, then text-only reasoning) plus
// blob reads and DB writes. Each pass is capped at OPENAI_TIMEOUT_MS so both
// fit inside this limit.
export const maxDuration = 60

const OPENAI_TIMEOUT_MS = 25_000
// Pass 1 only transcribes rows; Pass 2 returns one classified fault per row
// plus the directive, so trucks with 30-40 faults need the larger cap.
const OCR_MAX_COMPLETION_TOKENS = 4096
const DIAGNOSTIC_MAX_COMPLETION_TOKENS = 8192

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
6. detected_generation: "FH_V3" when codes are MID/PID/SID/PSID + FMI, "FH_V4" when they are UDS hex codes, otherwise "UNKNOWN". odometer_km: only if an odometer / mileage value is visible on screen, else null.

OUTPUT
Return ONLY one strict JSON object (no markdown) with exactly these keys:
{
  "detected_generation": "FH_V3" | "FH_V4" | "UNKNOWN",
  "odometer_km": number | null,
  "reported_dtc_list_count": number | null,
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

// ---------------------------------------------------------------------------
// Pass 2 system prompt: Volvo master diagnostic & enforcement engine
// ---------------------------------------------------------------------------

const DIAGNOSTIC_SYSTEM_PROMPT = `You are the Volvo Master Diagnostic & Enforcement Engine: an Elite Volvo Master Diagnostic Technician & Fleet Operations Strategist for Zambezi Portland Cement / Miloto Transport (Ndola, Zambia).

FLEET YOU SUPPORT
- Volvo FH V3: D13 engine, I-Shift gearbox AT2612D / AT2412C. Fault codes use the classic "MID / PID / PPID / SID / PSID + FMI" format.
- Volvo FH V4: D13 engine, I-Shift gearbox AT2612F. Fault codes are UDS hex codes such as U300054, P105F18, P008A00.

YOUR INPUT
You do NOT see screenshots. A vision OCR pass already transcribed them into a NUMBERED, deduplicated fault list (#1..#N), plus any VCADS pop-ups, truck metadata, optional workshop context, the 90-day spares history and the last prior PTT scans. Treat the numbered list as the complete, verbatim ground truth.

HARD RULES

1. ZERO DROPPED FAULTS. Your "faults" array MUST contain exactly one classified entry for EVERY SINGLE numbered row (#1..#N) - no row may be merged, skipped or summarised away - plus one "VCADS-OP-<n>" entry per VCADS pop-up. Echo the row number in source_row (e.g. 7 for "#7"; null for VCADS entries). Keep control_unit EXACTLY as given in the list (including the MID number) and copy fault_code from the row verbatim (uppercase). Never invent codes that are not in the list.

2. EXACT VOLVO FH V3 MID IDENTIFICATION MAP - NEVER CONFUSE ECUs:
- MID 128 = Engine ECU (EMS): D13 engine, injectors, fuel, air filter / crankcase sensors, EPG.
- MID 130 = Gearbox ECU (TECU / I-Shift): transmission tank air pressure (PID 37), clutch actuator, solenoids, datalink (PSID 204).
- MID 136 = Brake ECU (EBS / ABS): wheel speed sensors (SID 2), modulators, air brake circuits.
- MID 140 = Information Display / Instrument Cluster (IC): gauges, steering wheel buttons (PSID 46).
- MID 144 = Vehicle ECU (VECU): road speed (PID 84), air dryer regeneration (PSID 23), air compressor governor control (PSID 24), accelerator / PTO.
- MID 146 = Electronic Climate Control (ECC): CAB AIR CONDITIONING ONLY. SID 11 is the cab A/C magnetic clutch, NOT the engine or brake air compressor. NEVER classify cab A/C faults as CRITICAL.
- MID 185 = Air Production Modulator (APM): air drying, circuit pressures, air leakage calibration.
- MID 216 = Light Control Module (LCM): exterior / interior lamps.
- MID 222 = Retarder ECU (RECU): hydraulic retarder temperatures, air pressure, modulation valve.

3. STRICT 4-TIER SEVERITY RUBRIC - classify EVERY fault into exactly one tier:
- "CRITICAL": ACTIVE faults threatening safety, air supply / braking, transmission shifting, drivability, or major engine / gearbox damage. Examples: active transmission / brake air pressure (MID 130 PID 37, MID 144 PSID 23/24, APM pressure), active ABS / EBS (MID 136), active fuel / injector / oil / overheat (MID 128), active I-Shift actuator / clutch / solenoid or cross-ECU road-speed / datalink faults (PID 84, PSID 204), or a VCADS calibration failure indicating a mechanical / pneumatic fault (VCADS-OP-37). On FH V4 keep genuine fluid / overheat / air-supply / brake / I-Shift / injector-seizure faults CRITICAL, e.g. P111D00 (Engine Coolant Level Moderately Low), P250A13 (Engine Oil Level Sensor circuit open - oil level can no longer be monitored), and any active air-pressure, ABS, road-speed or I-Shift UDS fault.
- "CALIBRATION_ONLY": missing software calibration / programming (U300054, clutch X1 wear, APM air leakage initialisation, injector trim coding). ZERO parts approved. Set calibration_required = true.
- "MONITOR": non-immobilising ACTIVE faults or high-count INACTIVE faults. Examples: cab A/C (MID 146 ECC), exterior lamps (MID 216 LCM), steering buttons (MID 140), non-critical air-filter / crankcase sensors, or a bypassed / unplugged retarder cluster (MID 222) pending a harness check. On FH V4, non-immobilising auxiliary engine / chassis circuit faults are MONITOR, e.g. P101713 (Water In Fuel Drainage Valve open circuit) WHEN no active water-in-fuel or fuel-pressure fault is present (if one is present, escalate it to CRITICAL), C104415 (City Horn), C109C13 (Washer Fluid Sensor), C103715 (Chassis Lube Motor), and cab dash switch / climate LIN faults on CIOM or CCM (e.g. B151095, missing LIN messages). Still call out cab LIN / switch tampering (swapped, moved or unplugged dash switches / panels) cleanly in the secondary notes of true_diagnosis AFTER the Critical and Calibration clusters.
- "NEGLIGIBLE": low-count INACTIVE codes, old battery / voltage blips, or historical noise.

3b. VOLVO FH V4 UDS SUBTYPE BYTES. A UDS code such as P250A13 is a DTC base (P250A) plus a failure-type subtype byte (the LAST 2 HEX DIGITS, 13). Read the subtype on EVERY V4 row and let it drive the root-cause line and the first check:
- 13 = Circuit Open: check for an unplugged connector after recent service, a broken wire or a corroded pin BEFORE ordering any part.
- 15 = Circuit Short to Battery or Open: check the fuse, the connector and the loom for damage / chafing.
- 11 / 12 / 14 = Short to Ground / Short to Battery (circuit shorted): inspect the loom for chafing / water ingress and the connector for bridged pins.
- 87 = Missing Message on the CAN / LIN bus: check bus continuity, an unplugged or removed panel / module, and the power and ground feed to the silent node.
- 95 = Incorrect Assembly: e.g. CIOM B151095 means a Flexible Switch was moved / swapped into the wrong dash slot or is missing; verify the switch layout against the build specification.
- 54 = Missing Calibration: e.g. U300054 is CALIBRATION_ONLY with calibration_required = true and ZERO parts approved.
- 00 = Physical / condition fault with NO circuit error: the circuit is intact and the monitored condition is real. e.g. P111D00 Engine Coolant Level Moderately Low means coolant is actually low - order an immediate physical coolant level check and leak inspection (hoses, radiator, water pump weep hole, EGR cooler, cap), NOT just a wiring check.
Subtypes not listed above: state that the subtype is not in this table and fall back to the description wording; never invent a meaning.

4. CLUSTERED ROOT-CAUSE & "PARTS CANNON" INTELLIGENCE:
- Whenever 3+ components on the SAME ECU show FMI 5 (open circuit) or FMI 4 (shorted low) simultaneously (e.g. 4 MID 222 Retarder FMI 5 codes, 3+ MID 128 sensor FMI 5 codes, or multiple MID 216 rear lamps), explicitly diagnose a SHARED harness connector, chafed loom, dead power / ground feed, or bypassed unit, and explicitly ORDER the Workshop Manager NOT to replace individual sensors / valves until harness continuity and supply voltage are proven. Name the cluster in directive.parts_cannon_warning and directive.true_diagnosis.
- Trace upstream cascade faults: e.g. a MID 136 ABS sensor fault + MID 130 PSID 204 Data Link MID 136 + MID 128 / MID 144 PID 84 Road Speed = ONE shared speed / ABS signal root cause, not dead Engine / Gearbox ECUs.
- Cross-check every fault against the "90-DAY SPARES HISTORY" and "PRIOR PTT SCANS". Call out repeat part replacements and recurring / unresolved codes, referencing the exact spares line (date, part number, job card) or prior scan. When a related part was already replaced, do NOT recommend replacing it again: suspect upstream causes (fuel contamination, intake / air leaks, skipped calibration, damaged harness pins / connectors / corrosion, wrong or non-genuine part).
- COMPUTER-FIRST SOP: never approve a physical teardown or an expensive module / harness / injector / APM replacement without PTT Live Data proof. If the data contains no such proof, state which PTT Live Data / test must be run FIRST and approve NO parts. Missing post-repair calibrations (clutch X1 wear / kiss-point, APM air leakage initialisation, injector trim code C3I / IMA coding, actuator / gear-selector calibration) are CALIBRATION_ONLY with zero parts.

5. VCADS POP-UPS. Each pop-up becomes ONE fault entry: fault_code "VCADS-OP-<number>", code_format "OTHER", control_unit = the pop-up's target system (e.g. "TECU / Clutch Calibration", "APM / Air Leakage Test", "EMS / Injector Coding"; "VCADS" if unknown), component_description = the exact pop-up wording, fault_state "ACTIVE", occurrence_count null, source_row null. Severity is CRITICAL when the failure points to failed hardware or a driveline / safety risk (e.g. input shaft speed signal missing or implausible, clutch will not engage / disengage, air supply leaking), or CALIBRATION_ONLY when a precondition was not met (engine speed, air pressure, gear / parking-brake state, wrong procedure order) with zero parts approved. The entry's root_cause_summary and directive.true_diagnosis MUST state the exact MECHANICAL vs. PNEUMATIC root cause: mechanical (worn / glazed clutch disc, seized release bearing / clutch actuator, input shaft speed sensor gap / connector / harness pins, flywheel / housing damage) vs. pneumatic (low or leaking air supply, APM / actuator air leak, wet / contaminated air, blocked solenoid, pressure below calibration threshold), the single cheap check that separates the two, and which part is explicitly NOT to be replaced until that check is done.

6. BANNED GENERIC PTT PATHS & VERIFICATION CRITERIA:
- NEVER write generic paths like "PTT > Diagnostics > Fault Trace > View Fault Codes" or vague criteria like "confirm proper operation in live data".
- Every entry in ptt_navigation_paths MUST name the exact ECU (MID 130, MID 144, MID 136, ...) and the exact Live Data parameter or Component Test, e.g. "PTT > Test/Live Data > Gearbox ECU (MID 130) > Monitor Transmission Tank Air Pressure (bar) while building air to 10+ bar".
- Every entry in verification_criteria MUST name the exact fault codes that must turn Inactive / clear AND a measurable pass value (bar, volts, ohms, km/h or mm).

LENGTH BUDGET (your output is capped at about 8000 tokens and a truncated answer is a failed answer: keep the per-fault rows lean so 20-30 fault rows fit comfortably, and spend the depth in the directive)
- Per-fault rows: component_description = the OCR description, max ~12 words. root_cause_summary = ONE short sentence, max ~25 words, that names the subtype meaning for V4 codes (e.g. "Circuit open - check unplugged connector after service."); for clustered faults say "Part of <cluster name> - see directive" instead of repeating the explanation.
- directive.true_diagnosis: 2-4 dense, specific sentences (max ~150 words). It MUST explain EVERY Critical and Calibration cluster FIRST - each by name, with the exact codes, ECU, subtype meaning and the cheapest check that proves it - and only AFTER that mention secondary Monitor harness clusters (Retarder, Cab LIN / CIOM / CCM panels, lamps, horn, washer, chassis lube). Every sentence must carry a specific code, ECU, component or check.
- directive.parts_cannon_warning: 2-4 dense, specific sentences (max ~150 words) that name the EXACT components the mechanics are forbidden from ordering without proof, and the proof required first. Example: "Do NOT order an oil level sensor, water-in-fuel drain valve, CIOM or CCM until connector seating, pin condition and supply / ground at the connector are proven." / "Do NOT order individual retarder valves or sensors until the shared MID 222 connector and feed are proven." Use "" only when truly no parts are at risk.
- BANNED FILLER in true_diagnosis and parts_cannon_warning: generic phrases such as "wiring or connection issues affecting multiple systems", "do not replace sensors until wiring is checked", "check the harness" or "further investigation required". Always name the exact code, connector / ECU, component and check instead.
- directive.evidence_analysis max ~150 words; each list item one concise line; at most 6 items per list.

OUTPUT
Return ONLY one strict JSON object (no markdown) with exactly these keys:
{
  "detected_generation": "FH_V3" | "FH_V4" | "UNKNOWN",   // echo the OCR value
  "odometer_km": number | null,                            // echo the OCR / user value
  "overall_severity": "CRITICAL" | "CALIBRATION_ONLY" | "MONITOR" | "NEGLIGIBLE" | "CLEAR",  // worst fault tier, CLEAR if no faults
  "faults": [
    {
      "source_row": number | null,         // the "#n" row number; null for VCADS entries
      "fault_code": string,                // verbatim from the row, uppercase (or "VCADS-OP-<n>")
      "code_format": "V3_MID_FMI" | "V4_UDS" | "OTHER",
      "control_unit": string,              // EXACT control unit from the row, incl. MID number
      "component_description": string,
      "fault_state": "ACTIVE" | "INACTIVE" | "UNKNOWN",
      "occurrence_count": number | null,
      "severity": "CRITICAL" | "CALIBRATION_ONLY" | "MONITOR" | "NEGLIGIBLE",
      "root_cause_summary": string,
      "calibration_required": boolean
    }
  ],
  "directive": {
    "evidence_analysis": string,           // what the fault list, spares history and prior scans show
    "parts_cannon_warning": string,        // which parts must NOT be replaced yet and why ("" if none)
    "true_diagnosis": string,              // the single most likely true diagnosis for the Workshop Manager
    "physical_inspections": string[],      // cheap physical checks first (harness pins, connectors, air leaks, fuel quality ...)
    "ptt_navigation_paths": string[],      // exact PTT paths naming the ECU and Live Data parameter / Component Test
    "verification_criteria": string[]      // fault codes that must clear + measurable pass values
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
// OpenAI calls
// ---------------------------------------------------------------------------

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming

// Runs one JSON-mode completion and validates it. Both passes use a hard
// per-call timeout and no retries so two calls always fit in `maxDuration`.
async function runJsonPass<S extends z.ZodType>(
  openai: OpenAI,
  label: string,
  schema: S,
  params: ChatParams
): Promise<z.output<S>> {
  let response: OpenAI.Chat.Completions.ChatCompletion
  try {
    response = await openai.chat.completions.create(params, {
      timeout: OPENAI_TIMEOUT_MS,
      maxRetries: 0,
    })
  } catch (error) {
    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      throw new AnalyzeError(
        `${label} timed out after ${OPENAI_TIMEOUT_MS / 1000}s. Try again, or upload fewer screenshots per scan.`,
        504
      )
    }
    throw error
  }

  const choice = response.choices[0]
  if (choice?.finish_reason === "length") {
    throw new AnalyzeError(
      `${label} output was too long and got cut off. Split the screenshots into smaller batches and scan again.`,
      502
    )
  }
  const content = choice?.message?.content
  if (!content) throw new AnalyzeError(`${label} returned an empty response.`, 502)

  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    throw new AnalyzeError(`${label} returned invalid JSON. Please try again.`, 502)
  }
  const validated = schema.safeParse(json)
  if (!validated.success) {
    console.error(`[ptt-analyze] ${label} schema mismatch:`, validated.error.issues)
    throw new AnalyzeError(
      `${label} did not match the expected format. Please try again.`,
      502
    )
  }
  return validated.data
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

const SEVERITY_RANK = Object.fromEntries(
  PTT_FAULT_SEVERITIES.map((s, i) => [s, i])
) as Record<(typeof PTT_FAULT_SEVERITIES)[number], number>

// Safety net behind the prompt's one-entry-per-row rule: one row per code +
// control unit, keeping the worst severity and the highest occurrence count.
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
// `/api/diagnostics/upload`) with a 2-pass OpenAI pipeline:
//   Pass 1 - exhaustive verbatim vision OCR of every row on every screenshot.
//   Pass 2 - text-only Volvo diagnostic reasoning over the deduplicated,
//            numbered rows, the truck's 90-day spares history and prior scans.
// The result is stored as a new diagnostic session. Blob credentials come
// from the Vercel OIDC environment (no manual `token`).
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
    const model = process.env.OPENAI_DIAGNOSTICS_MODEL || "gpt-4o"

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

    // Each pass has its own 25s timeout (set per call) and no retries.
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: OPENAI_TIMEOUT_MS,
      maxRetries: 0,
    })

    // ---- PASS 1: exhaustive verbatim vision OCR ---------------------------
    const ocrContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      {
        type: "text",
        text: [
          `Fleet ID: ${input.fleetId}`,
          `Truck generation (user-selected): ${input.truckGeneration}`,
          `Screenshots attached: ${photos.length} (same truck, may overlap). Transcribe EVERY row of EVERY screenshot.`,
        ].join("\n"),
      },
    ]
    photos.forEach((p, index) => {
      ocrContent.push(
        { type: "text", text: `Screenshot ${index + 1} of ${photos.length}:` },
        { type: "image_url", image_url: { url: p.dataUrl, detail: "high" } }
      )
    })

    const ocr = await runJsonPass(openai, "Screenshot transcription", pttRawOcrSchema, {
      model,
      temperature: 0,
      max_tokens: OCR_MAX_COMPLETION_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: OCR_SYSTEM_PROMPT },
        { role: "user", content: ocrContent },
      ],
    })

    // Deterministic dedupe across overlapping scrolled screenshots, then
    // number the survivors #1..#N.
    const numberedRows = dedupeAndNumberRawRows(ocr.raw_rows)
    const popups = dedupeVcadsPopups(ocr.vcads_popups)
    const reportedCount = ocr.reported_dtc_list_count
    const incompleteTranscription =
      reportedCount != null && numberedRows.length < reportedCount
    if (incompleteTranscription) {
      console.warn(
        `[ptt-analyze] DTC List reports ${reportedCount} items but only ${numberedRows.length} distinct rows were transcribed`
      )
    }

    // ---- PASS 2: Volvo master diagnostic & enforcement (text only) --------
    const odometerForPrompt =
      input.odometerKm ?? toOdometer(ocr.odometer_km)
    const generationForPrompt =
      input.truckGeneration !== "UNKNOWN"
        ? input.truckGeneration
        : ocr.detected_generation

    const diagnosticText = [
      `Fleet ID: ${input.fleetId}`,
      `Truck generation: ${generationForPrompt}`,
      `Odometer: ${odometerForPrompt != null ? `${odometerForPrompt} km` : "not provided"}`,
      `Scan batch: ${input.scanBatchLabel ?? "n/a"}`,
      `Today: ${isoDate(new Date())}`,
      "",
      `PASS 1 TRANSCRIBED FAULT LIST - ${numberedRows.length} distinct row(s) (#1..#${numberedRows.length}); you MUST return one classified fault per row:`,
      formatNumberedFaultList(numberedRows),
      ...(incompleteTranscription
        ? [
            "",
            `TRANSCRIPTION WARNING: the PTT "DTC List" header reported ${reportedCount} items but only ${numberedRows.length} distinct rows could be read. Say so in evidence_analysis and tell the Workshop Manager to re-scan with overlapping screenshots.`,
          ]
        : []),
      "",
      `VCADS POP-UPS (${popups.length}); return one VCADS-OP-<n> fault per pop-up:`,
      formatVcadsPopupList(popups),
      "",
      `WORKSHOP CONTEXT (driver complaint / what the mechanics want to replace):\n${input.workshopContext ?? "None provided."}`,
      "",
      `90-DAY SPARES HISTORY:\n${formatSparesSummary(spares)}`,
      "",
      `PRIOR PTT SCANS (most recent first):\n${formatPriorScansSummary(priorSessions)}`,
    ].join("\n")

    const analysis = await runJsonPass(
      openai,
      "Diagnostic reasoning",
      pttAnalysisResultSchema,
      {
        model,
        temperature: 0.1,
        max_tokens: DIAGNOSTIC_MAX_COMPLETION_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: DIAGNOSTIC_SYSTEM_PROMPT },
          { role: "user", content: diagnosticText },
        ],
      }
    )

    // Deterministic safety net: no extracted row or VCADS pop-up may silently
    // disappear. Coverage is checked on Pass 2's raw output (before dedupe).
    const uncoveredRows = findUncoveredRows(numberedRows, analysis.faults)
    const uncoveredPopups = findUncoveredPopups(popups, analysis.faults)
    if (uncoveredRows.length > 0 || uncoveredPopups.length > 0) {
      console.warn(
        `[ptt-analyze] Pass 2 omitted ${uncoveredRows.length} row(s) and ${uncoveredPopups.length} VCADS pop-up(s); appending fallback entries`
      )
    }

    // Counts and overall severity are derived here, not taken from the model.
    // The cab A/C clamp runs first so a mis-tiered ECC / MID 146 fault can
    // never inflate the counts or the truck's overall severity.
    const faults = clampCabClimateSeverity([
      ...dedupeFaults(analysis.faults),
      ...uncoveredRows.map(fallbackFaultFromRow),
      ...uncoveredPopups.map(fallbackFaultFromPopup),
    ])
    const summary = summarizePttFaults(
      faults.map((f) => ({ severity: f.severity }))
    )

    const notes: string[] = []
    const appended = uncoveredRows.length + uncoveredPopups.length
    if (appended > 0) {
      notes.push(
        `${appended} fault(s) were auto-appended because the diagnostic engine did not classify them (${[...uncoveredRows.map((r) => `#${r.n}`), ...uncoveredPopups.map((p) => `VCADS-OP-${p.opNumber ?? "?"}`)].join(", ")}); their tiers are conservative defaults - review them manually.`
      )
    }
    if (incompleteTranscription) {
      notes.push(
        `PTT reported ${reportedCount} DTC List items but only ${numberedRows.length} distinct rows could be read from the screenshots - re-scan with overlapping screenshots to capture the rest.`
      )
    }
    const directive =
      notes.length > 0
        ? {
            ...analysis.directive,
            evidence_analysis: [
              analysis.directive.evidence_analysis.trim(),
              ...notes.map((n) => `Note: ${n}`),
            ]
              .filter(Boolean)
              .join("\n\n"),
          }
        : analysis.directive

    const truckGeneration =
      input.truckGeneration !== "UNKNOWN"
        ? input.truckGeneration
        : ocr.detected_generation !== "UNKNOWN"
          ? ocr.detected_generation
          : analysis.detected_generation
    const odometerKm =
      input.odometerKm ??
      toOdometer(ocr.odometer_km) ??
      toOdometer(analysis.odometer_km)

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
        aiDirective: directive,
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
