import { del } from "@vercel/blob"
import { eq } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import OpenAI from "openai"
import { z } from "zod"

import { db } from "@/db"
import {
  pttDiagnosticSessionsTable,
  pttFaultCodesTable,
  pttScanFaultsTable,
  pttSessionAttachmentsTable,
} from "@/db/schema"
import { HrAuthError, requireAdmin } from "@/lib/hr-admin-auth"
import {
  PTT_CODE_FORMATS,
  PTT_FAULT_SEVERITIES,
  PTT_FAULT_STATES,
  PTT_OVERALL_SEVERITIES,
  PTT_TRUCK_GENERATIONS,
  normalizeFleetId,
  pttAnalysisResultSchema,
  summarizePttFaults,
  type PttFault,
  type PttSparesContextItem,
  type PttTruckGeneration,
} from "@/lib/ptt-diagnostics"
import {
  clampCabClimateSeverity,
  dedupeAndNumberRawRows,
  dedupeVcadsPopups,
  fallbackFaultFromPopup,
  fallbackFaultFromRow,
  findUncoveredPopups,
  findUncoveredRows,
  vcadsFaultCode,
} from "@/lib/ptt-ocr-pipeline"
import { pttBlobPrefix } from "@/lib/ptt-files"
import {
  BASELINE_SYSTEM_PROMPT,
  buildBaselinePass2Payload,
  type BaselineClassifiedRow,
} from "@/lib/ptt/baseline-prompt"
import {
  ledgerUpsertStatement,
  loadApplicableExceptions,
  loadLedgerMap,
  toScanFaultRows,
} from "@/lib/ptt/case-db"
import {
  PttPipelineError,
  loadPhotos,
  pttUploadedAttachmentSchema,
  runJsonPass,
  runVisionOcr,
} from "@/lib/ptt/extraction"
import {
  checkScanCompleteness,
  checkSelectedFooterCoverage,
} from "@/lib/ptt/gates"
import { planLedgerCommit, type LedgerScanFault } from "@/lib/ptt/ledger"
import { matchesApprovedException } from "@/lib/ptt/reconcile"
import {
  buildScanFaultRecords,
  canonicalKeyFor,
  countExtractedDtcRows,
  inferGenerationFromRecords,
  toScanFaultStatus,
} from "@/lib/ptt/scan-faults"
import {
  applyDeterministicSeverity,
  buildFleetPatternPayload,
  classifyFaultSeverity,
  detectFleetPatterns,
  type SeverityContext,
} from "@/lib/ptt/severity-and-patterns"
import { querySessionDetail } from "@/lib/ptt/session-query"

// Two sequential OpenAI passes (vision OCR, then text-only reasoning) plus
// blob reads and DB writes. Each pass has its own timeout; together they leave
// ~6s of headroom inside this limit for blob reads and DB writes.
export const maxDuration = 60

const DIAGNOSTIC_TIMEOUT_MS = 32_000
// Pass 2 returns one classified fault per row plus the directive, so trucks
// with 30-40 faults need a large completion cap (Pass 1 lives in
// src/lib/ptt/extraction.ts).
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
    .array(pttUploadedAttachmentSchema, {
      error: "At least one screenshot is required",
    })
    .min(1, { error: "At least one screenshot is required" })
    .max(MAX_ATTACHMENTS, {
      error: `At most ${MAX_ATTACHMENTS} screenshots per analysis`,
    }),
})


function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status })
}


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

// Hand-written JSON Schemas for Pass 1 and Pass 2, used with OpenAI Structured
// Outputs (`strict: true`). Deliberately NOT derived from Zod (no
// `zodResponseFormat`) so a Zod v3/v4 SDK mismatch can never break them.
// Strict-mode rules: every object has `additionalProperties: false` and lists
// ALL its keys in `required`; optional values are expressed as nullable types;
// and the unsupported keywords (pattern, min/maxLength, min/maxItems, minimum,
// maximum, default) are not used. Enums mirror src/lib/ptt-diagnostics.ts. The
// Zod schemas (`pttRawOcrSchema`, `pttAnalysisResultSchema`) still re-validate
// the parsed output.
const stringArray = { type: "array", items: { type: "string" } } as const

// Pass 1: mirrors `pttRawOcrSchema`.

const PASS2_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "detected_generation",
    "odometer_km",
    "overall_severity",
    "faults",
    "directive",
  ],
  properties: {
    detected_generation: { type: "string", enum: [...PTT_TRUCK_GENERATIONS] },
    odometer_km: { type: ["number", "null"] },
    overall_severity: { type: "string", enum: [...PTT_OVERALL_SEVERITIES] },
    faults: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "source_row",
          "fault_code",
          "code_format",
          "control_unit",
          "component_description",
          "fault_state",
          "occurrence_count",
          "severity",
          "root_cause_summary",
          "calibration_required",
        ],
        properties: {
          source_row: { type: ["integer", "null"] },
          fault_code: { type: "string" },
          code_format: { type: "string", enum: [...PTT_CODE_FORMATS] },
          control_unit: { type: "string" },
          component_description: { type: "string" },
          fault_state: { type: "string", enum: [...PTT_FAULT_STATES] },
          occurrence_count: { type: ["number", "null"] },
          severity: { type: "string", enum: [...PTT_FAULT_SEVERITIES] },
          root_cause_summary: { type: "string" },
          calibration_required: { type: "boolean" },
        },
      },
    },
    directive: {
      type: "object",
      additionalProperties: false,
      required: [
        "evidence_analysis",
        "parts_cannon_warning",
        "true_diagnosis",
        "physical_inspections",
        "ptt_navigation_paths",
        "verification_criteria",
      ],
      properties: {
        evidence_analysis: { type: "string" },
        parts_cannon_warning: { type: "string" },
        true_diagnosis: { type: "string" },
        physical_inspections: stringArray,
        ptt_navigation_paths: stringArray,
        verification_criteria: stringArray,
      },
    },
  },
} as const

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
  // Once the batch committed, a later failure must not undo the scan.
  let committed = false

  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new PttPipelineError("OPENAI_API_KEY is not configured on the server.", 500)
    }
    const model = process.env.OPENAI_DIAGNOSTICS_MODEL || "gpt-4o"

    // 1-2. Spares history + prior scans.
    const [spares, priorSessions] = await Promise.all([
      loadSparesContext(input.fleetId),
      loadPriorSessions(input.fleetId),
    ])

    // 3. Read + hash the private photos (SHA-256 is stored for the
    // recycled-screenshot gate of later verification scans).
    const photos = await loadPhotos(input.attachments)

    // Each pass has its own timeout (set per call) and no retries.
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: DIAGNOSTIC_TIMEOUT_MS,
      maxRetries: 0,
    })

    // ---- PASS 1: exhaustive verbatim vision OCR ---------------------------
    const ocr = await runVisionOcr({
      openai,
      model,
      fleetId: input.fleetId,
      truckGeneration: input.truckGeneration,
      photos,
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

    // ---- DETERMINISTIC STEP: keys, severity, exceptions, fleet patterns ----
    // Between Pass 1 and Pass 2: the LLM never decides a tier.
    const odometerForPrompt =
      input.odometerKm ?? toOdometer(ocr.odometer_km)
    const generationHint: PttTruckGeneration =
      input.truckGeneration !== "UNKNOWN"
        ? input.truckGeneration
        : ocr.detected_generation
    const resolvedGeneration: PttTruckGeneration =
      generationHint !== "UNKNOWN"
        ? generationHint
        : inferGenerationFromRecords(
            numberedRows.map((row) => ({
              canonicalKey: canonicalKeyFor(
                row.control_unit_verbatim,
                row.fault_code_verbatim,
                "UNKNOWN"
              ),
            }))
          )

    const [exceptions, existingLedger] = await Promise.all([
      loadApplicableExceptions(input.fleetId, resolvedGeneration),
      loadLedgerMap(input.fleetId),
    ])
    const severityContext: SeverityContext = {
      fleetId: input.fleetId,
      generation: resolvedGeneration,
      exceptions,
    }

    const classifiedRows = numberedRows.map((row) => {
      const canonicalKey = canonicalKeyFor(
        row.control_unit_verbatim,
        row.fault_code_verbatim,
        resolvedGeneration
      )
      const pttStatus = toScanFaultStatus(row.fault_state)
      const decision = classifyFaultSeverity(
        {
          canonicalKey,
          pttStatus,
          ecuLabel: row.control_unit_verbatim,
          description: row.description_verbatim,
        },
        severityContext
      )
      return { row, canonicalKey, pttStatus, decision }
    })
    const fleetPatterns = buildFleetPatternPayload(
      detectFleetPatterns(
        classifiedRows.map(({ row, canonicalKey, pttStatus, decision }) => ({
          canonicalKey,
          pttStatus,
          description: row.description_verbatim,
          isApprovedException: decision.isApprovedException,
        }))
      )
    )

    const footerCheck = checkSelectedFooterCoverage(
      ocr.selected_footer_text,
      numberedRows.map((row) => row.description_verbatim)
    )
    const transcriptionWarnings = [
      ...(incompleteTranscription
        ? [
            `the PTT "DTC List" header reported ${reportedCount} items but only ${numberedRows.length} distinct rows could be read. Say so in evidence_analysis and tell the Workshop Manager to re-scan with overlapping screenshots.`,
          ]
        : []),
      ...(footerCheck.message ? [footerCheck.message] : []),
    ]

    // ---- PASS 2 (BASELINE mode): directive over pre-classified faults ------
    const baselineRows: BaselineClassifiedRow[] = classifiedRows.map(
      ({ row, canonicalKey, decision }) => ({
        row: row.n,
        canonicalKey,
        controlUnit: row.control_unit_verbatim || "(unit not readable)",
        faultCode: row.fault_code_verbatim,
        codeFormat: row.code_format,
        description: row.description_verbatim || "(no description)",
        state: row.fault_state,
        count: row.occurrence_count,
        severity: decision.severity,
        isApprovedException: decision.isApprovedException,
      })
    )
    const diagnosticText = buildBaselinePass2Payload({
      fleetId: input.fleetId,
      generation: resolvedGeneration,
      odometerKm: odometerForPrompt,
      scanBatch: input.scanBatchLabel ?? null,
      today: isoDate(new Date()),
      rows: baselineRows,
      popups: popups.map((popup) => ({
        faultCode: vcadsFaultCode(popup),
        targetSystem: popup.target_system || "unknown",
        message: popup.message,
        background: popup.background_context || "n/a",
        severity: classifyFaultSeverity(
          {
            canonicalKey: `VCADS|OP${popup.opNumber ?? "UNKNOWN"}`,
            pttStatus: "ACTIVE",
            ecuLabel: popup.target_system,
          },
          severityContext
        ).severity,
      })),
      fleetPatterns,
      workshopContext: input.workshopContext ?? null,
      spares,
      priorScans: formatPriorScansSummary(priorSessions),
      transcriptionWarning:
        transcriptionWarnings.length > 0
          ? `TRANSCRIPTION WARNING: ${transcriptionWarnings.join(" ")}`
          : null,
    })

    const analysis = await runJsonPass(
      openai,
      "Diagnostic reasoning",
      pttAnalysisResultSchema,
      {
        model,
        temperature: 0.1,
        max_tokens: DIAGNOSTIC_MAX_COMPLETION_TOKENS,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ptt_diagnostic_analysis",
            strict: true,
            schema: PASS2_JSON_SCHEMA,
          },
        },
        messages: [
          { role: "system", content: BASELINE_SYSTEM_PROMPT },
          { role: "user", content: diagnosticText },
        ],
      },
      DIAGNOSTIC_TIMEOUT_MS
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

    // Tiers, counts and overall severity are derived here, not taken from the
    // model: the deterministic engine re-tiers EVERY fault (including the
    // auto-appended fallbacks) so Pass 2 can never move a severity. The cab
    // A/C clamp stays as a final guard.
    const faults = clampCabClimateSeverity(
      applyDeterministicSeverity(
        [
          ...dedupeFaults(analysis.faults),
          ...uncoveredRows.map(fallbackFaultFromRow),
          ...uncoveredPopups.map(fallbackFaultFromPopup),
        ],
        severityContext
      )
    )
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
    if (footerCheck.message) notes.push(footerCheck.message)
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
      resolvedGeneration !== "UNKNOWN"
        ? resolvedGeneration
        : analysis.detected_generation
    const odometerKm =
      input.odometerKm ??
      toOdometer(ocr.odometer_km) ??
      toOdometer(analysis.odometer_km)

    // ---- Reconciliation snapshot: canonical keys + truck fault ledger -----
    const scanRecords = buildScanFaultRecords(
      faults.map((f) => ({
        controlUnit: f.control_unit,
        faultCode: f.fault_code,
        description: f.component_description,
        faultState: f.fault_state,
        severity: f.severity,
      })),
      truckGeneration
    )
    const extractedItemCount = countExtractedDtcRows(scanRecords)
    const completeness = checkScanCompleteness(
      ocr.reported_dtc_list_count,
      extractedItemCount
    )
    const isException = (key: string) =>
      matchesApprovedException(exceptions, input.fleetId, truckGeneration, key)
    const now = new Date()

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
        scanRole: "BASELINE",
        caseStatus: "OPEN",
        headerItemCount: ocr.reported_dtc_list_count,
        extractedItemCount,
        isCompleteScan: completeness.isComplete,
        chassisIdOcr: ocr.chassis_id_ocr,
        workOrderOcr: ocr.work_order_ocr,
        productTimeOcr: ocr.product_time_ocr,
        imageHashes: photos.map((photo) => photo.sha256),
      })
      .returning()
    createdSessionId = session.id

    // Only ACTIVE faults open (or reopen) ledger rows; a fault that was
    // cleared within the last 30 days and is active again is a bounce-back.
    const ledgerPlan = planLedgerCommit({
      fleetId: input.fleetId,
      scanId: session.id,
      now,
      activeFaults: scanRecords
        .filter((record) => record.pttStatus === "ACTIVE")
        .map(
          (record): LedgerScanFault => ({
            canonicalKey: record.canonicalKey,
            ecuLabel: record.ecuLabel,
            description: record.description,
            severity: record.severity,
            isApprovedException: isException(record.canonicalKey),
          })
        ),
      existing: existingLedger,
    })

    const scanFaultRows = toScanFaultRows(scanRecords, {
      scanId: session.id,
      bucketByKey: new Map(),
      bounceBackKeys: ledgerPlan.bounceBackKeys,
      exceptionKeys: new Set(
        scanRecords
          .filter((record) => isException(record.canonicalKey))
          .map((record) => record.canonicalKey)
      ),
    })

    const statements: [BatchItem<"pg">, ...BatchItem<"pg">[]] = [
      db.insert(pttSessionAttachmentsTable).values(
        photos.map((p) => ({
          sessionId: session.id,
          role: "INITIAL_SCAN" as const,
          fileName: p.fileName,
          blobPathname: p.blobPathname,
          blobUrl: p.blobUrl,
          contentType: p.contentType,
          fileSize: p.fileSize,
        }))
      ),
    ]
    if (faults.length > 0) {
      statements.push(
        db.insert(pttFaultCodesTable).values(
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
      )
    }
    if (scanFaultRows.length > 0) {
      statements.push(db.insert(pttScanFaultsTable).values(scanFaultRows))
    }
    const ledgerStatement = ledgerUpsertStatement(ledgerPlan.upserts)
    if (ledgerStatement) statements.push(ledgerStatement)
    await db.batch(statements)
    committed = true

    const created = await querySessionDetail(session.id)
    if (!created) throw new PttPipelineError("Scan could not be reloaded", 500)

    revalidatePath("/diagnostics")
    return NextResponse.json({ success: true, data: created })
  } catch (error) {
    console.error("[ptt-analyze] analysis failed:", error)

    // Roll back: no session row and no orphaned screenshots.
    if (createdSessionId !== null && !committed) {
      await db
        .delete(pttDiagnosticSessionsTable)
        .where(eq(pttDiagnosticSessionsTable.id, createdSessionId))
        .catch((cleanupError) =>
          console.error("[ptt-analyze] session rollback failed:", cleanupError)
        )
    }
    if (!committed) {
      await del(input.attachments.map((a) => a.blobPathname)).catch(
        (cleanupError) =>
          console.error("[ptt-analyze] blob cleanup failed:", cleanupError)
      )
    }

    if (error instanceof PttPipelineError) return fail(error.message, error.status)
    return fail("Analysis failed. Please try again.", 500)
  }
}
