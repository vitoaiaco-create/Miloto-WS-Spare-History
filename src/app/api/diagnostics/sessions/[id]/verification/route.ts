import { del } from "@vercel/blob"
import { arrayOverlaps, eq } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"
import { revalidatePath } from "next/cache"
import { NextResponse } from "next/server"
import OpenAI from "openai"
import { z } from "zod"

import { db } from "@/db"
import {
  pttDiagnosticSessionsTable,
  pttScanFaultsTable,
  pttSessionAttachmentsTable,
} from "@/db/schema"
import { HrAuthError, requireAdmin } from "@/lib/hr-admin-auth"
import {
  summarizePttFaults,
  type PttTruckGeneration,
} from "@/lib/ptt-diagnostics"
import {
  dedupeAndNumberRawRows,
  dedupeVcadsPopups,
  provisionalSeverityForRow,
  vcadsFaultCode,
} from "@/lib/ptt-ocr-pipeline"
import { pttBlobPrefix } from "@/lib/ptt-files"
import {
  applyUpserts,
  ledgerUpsertStatement,
  loadApplicableExceptions,
  loadBaselineSnapshot,
  loadLedgerMap,
  toScanFaultRows,
} from "@/lib/ptt/case-db"
import { isClosedCaseStatus, type PttGateOverride } from "@/lib/ptt/constants"
import {
  PttPipelineError,
  loadPhotos,
  pttUploadedAttachmentSchema,
  runVisionOcr,
} from "@/lib/ptt/extraction"
import {
  buildGateOverride,
  checkScanCompleteness,
  checkTruckIdentity,
  findRecycledImages,
  formatRecycledImageError,
} from "@/lib/ptt/gates"
import {
  detectBounceBacks,
  planLedgerCommit,
  type LedgerScanFault,
} from "@/lib/ptt/ledger"
import {
  matchesApprovedException,
  reconcileDiagnosticScans,
} from "@/lib/ptt/reconcile"
import {
  buildScanFaultRecords,
  countExtractedDtcRows,
  inferGenerationFromRecords,
  isVcadsSuccessMessage,
  type ExtractedFaultInput,
  type ScanFaultRecord,
} from "@/lib/ptt/scan-faults"
import { querySessionDetail } from "@/lib/ptt/session-query"
import {
  classifyFaultSeverity,
  resolveSeverity,
  type SeverityContext,
} from "@/lib/ptt/severity-and-patterns"
import { generateVerificationForensicAudit } from "@/lib/ptt/verification-audit"
import {
  buildVerificationAuditInput,
  type PttVerificationAudit,
} from "@/lib/ptt/verification-audit-schema"

// One vision pass (22s) plus blob reads and one atomic batch of DB writes.
export const maxDuration = 60

const MAX_VERIFICATION_ATTACHMENTS = 10

const sessionIdSchema = z.coerce.number().int().positive()

const optionalReason = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((value) => (value ? value : null))

const verificationRequestSchema = z.object({
  attachments: z
    .array(pttUploadedAttachmentSchema, {
      error: "At least one verification screenshot is required",
    })
    .min(1, { error: "At least one verification screenshot is required" })
    .max(MAX_VERIFICATION_ATTACHMENTS, {
      error: `At most ${MAX_VERIFICATION_ATTACHMENTS} verification screenshots`,
    }),
  // Manager overrides; each is only honoured with a non-blank reason.
  incompleteScanOverrideReason: optionalReason,
  truckMismatchOverrideReason: optionalReason,
})

type RouteContext = { params: Promise<{ id: string }> }

function fail(
  error: string,
  status: number,
  code: string | null = null,
  details: Record<string, unknown> | null = null
) {
  return NextResponse.json({ success: false, error, code, details }, { status })
}

// Post-work verification of a baseline PTT scan: a deterministic Before/After
// set-diff on canonical fault keys (no AI judgement of the outcome).
//   1. Recycled-image gate (SHA-256 against every stored scan).
//   2. Pass 1 vision OCR (DTC rows + header count + status bar).
//   3. Header-count completeness and truck-identity gates.
//   4. 5-way reconciliation vs the baseline, approved exceptions applied.
//   5. One atomic `db.batch`: verification scan, fault snapshot (with
//      buckets), screenshots, truck fault ledger and the case verdict.
export async function POST(request: Request, ctx: RouteContext) {
  let userId: string
  try {
    userId = await requireAdmin()
  } catch (error) {
    if (error instanceof HrAuthError) return fail(error.message, error.status)
    throw error
  }

  const parsedId = sessionIdSchema.safeParse((await ctx.params).id)
  if (!parsedId.success) return fail("Invalid session id", 400)
  const baselineId = parsedId.data

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail("Expected a JSON body", 400)
  }
  const parsed = verificationRequestSchema.safeParse(body)
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid request", 400)
  }
  const input = parsed.data

  const baseline = await db.query.pttDiagnosticSessionsTable.findFirst({
    where: { id: baselineId },
    with: { faults: true },
  })
  if (!baseline) {
    // Nothing of ours to keep: drop the temporary uploads.
    await del(input.attachments.map((a) => a.blobPathname)).catch(() => undefined)
    return fail("Session not found", 404)
  }

  let createdSessionId: number | null = null
  // Once the batch committed, a later failure must not undo the scan.
  let committed = false

  try {
    if (baseline.scanRole !== "BASELINE") {
      throw new PttPipelineError(
        "A verification scan can only be attached to a baseline scan.",
        400
      )
    }
    if (isClosedCaseStatus(baseline.caseStatus)) {
      throw new PttPipelineError(
        baseline.caseStatus === "CLOSED_ACCEPTED_RESIDUALS"
          ? "This case is CLOSED (ACCEPTED RESIDUALS). Reopen it first, or start a new baseline scan to open a new case."
          : "This case is already VERIFIED CLOSED. Start a new baseline scan to open a new case.",
        409,
        "CASE_CLOSED"
      )
    }

    const fleetId = baseline.fleetId
    const prefix = pttBlobPrefix(fleetId)
    const badPath = input.attachments.find(
      (a) => !a.blobPathname.startsWith(prefix) || a.blobPathname.includes("..")
    )
    if (badPath) {
      throw new PttPipelineError(
        `Screenshot "${badPath.fileName}" does not belong to ${fleetId}`,
        400
      )
    }
    if (!process.env.OPENAI_API_KEY) {
      throw new PttPipelineError("OPENAI_API_KEY is not configured on the server.", 500)
    }
    const model = process.env.OPENAI_DIAGNOSTICS_MODEL || "gpt-4o"
    const now = new Date()

    // ---- Gate 1: duplicate / recycled images -----------------------------
    const photos = await loadPhotos(input.attachments)
    const hashes = photos.map((photo) => photo.sha256)
    const priorScans = await db
      .select({
        scanId: pttDiagnosticSessionsTable.id,
        fleetId: pttDiagnosticSessionsTable.fleetId,
        scannedAt: pttDiagnosticSessionsTable.scannedAt,
        imageHashes: pttDiagnosticSessionsTable.imageHashes,
      })
      .from(pttDiagnosticSessionsTable)
      .where(arrayOverlaps(pttDiagnosticSessionsTable.imageHashes, hashes))
    const recycled = findRecycledImages(hashes, priorScans)
    if (recycled.length > 0) {
      throw new PttPipelineError(
        formatRecycledImageError(
          recycled,
          photos.map((photo) => photo.fileName)
        ),
        409,
        "RECYCLED_IMAGE",
        {
          images: recycled.map((item) => ({
            fileName: photos[item.index]?.fileName ?? null,
            previousFleetId: item.previous?.fleetId ?? null,
            previousScannedAt: item.previous?.scannedAt.toISOString() ?? null,
          })),
        }
      )
    }

    // ---- Pass 1: vision OCR ------------------------------------------------
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30_000,
      maxRetries: 0,
    })
    const ocr = await runVisionOcr({
      openai,
      model,
      fleetId,
      truckGeneration: baseline.truckGeneration,
      photos,
    })

    const numberedRows = dedupeAndNumberRawRows(ocr.raw_rows)
    const popups = dedupeVcadsPopups(ocr.vcads_popups)

    const baselineSnapshot = await loadBaselineSnapshot(baseline)
    const generation: PttTruckGeneration =
      baseline.truckGeneration !== "UNKNOWN"
        ? baseline.truckGeneration
        : ocr.detected_generation !== "UNKNOWN"
          ? ocr.detected_generation
          : inferGenerationFromRecords(baselineSnapshot.records)

    const extracted: ExtractedFaultInput[] = [
      ...numberedRows.map(
        (row): ExtractedFaultInput => ({
          controlUnit: row.control_unit_verbatim,
          faultCode: row.fault_code_verbatim,
          description: row.description_verbatim,
          faultState: row.fault_state,
          severity: provisionalSeverityForRow(row),
        })
      ),
      ...popups.map(
        (popup): ExtractedFaultInput => ({
          controlUnit: popup.target_system.trim() || "VCADS",
          faultCode: vcadsFaultCode(popup),
          description: popup.message.trim(),
          faultState: isVcadsSuccessMessage(popup.message) ? "INACTIVE" : "ACTIVE",
          severity: "CRITICAL",
        })
      ),
    ]
    const rawRecords = buildScanFaultRecords(extracted, generation)

    // ---- Gate 2: header-count completeness ----------------------------------
    const extractedItemCount = countExtractedDtcRows(rawRecords)
    const completeness = checkScanCompleteness(
      ocr.reported_dtc_list_count,
      extractedItemCount
    )
    const gateOverrides: PttGateOverride[] = []
    if (!completeness.isComplete) {
      const override = input.incompleteScanOverrideReason
        ? buildGateOverride(
            "INCOMPLETE_SCAN",
            input.incompleteScanOverrideReason,
            userId,
            now
          )
        : null
      if (!override) {
        throw new PttPipelineError(
          `${completeness.message}. Automatic closure is blocked until the missing page(s) are uploaded, or a manager overrides with a reason.`,
          422,
          "INCOMPLETE_SCAN",
          {
            capturedCount: completeness.extractedItemCount,
            headerItemCount: completeness.headerItemCount,
          }
        )
      }
      gateOverrides.push(override)
    }

    // ---- Gate 3: truck identity ----------------------------------------------
    const identity = checkTruckIdentity(fleetId, ocr.work_order_ocr)
    const generationConflict =
      baseline.truckGeneration !== "UNKNOWN" &&
      ocr.detected_generation !== "UNKNOWN" &&
      baseline.truckGeneration !== ocr.detected_generation
    if (identity.conflict || generationConflict) {
      const override = input.truckMismatchOverrideReason
        ? buildGateOverride(
            "TRUCK_MISMATCH",
            input.truckMismatchOverrideReason,
            userId,
            now
          )
        : null
      if (!override) {
        throw new PttPipelineError(
          identity.message ??
            `TRUCK_MISMATCH: the screenshots look like ${ocr.detected_generation} but ${fleetId} is registered as ${baseline.truckGeneration}. Check that the photos belong to the right truck.`,
          422,
          "TRUCK_MISMATCH",
          { workOrderOcr: ocr.work_order_ocr, fleetId }
        )
      }
      gateOverrides.push(override)
    }

    // ---- Reconciliation --------------------------------------------------------
    const [exceptions, ledgerBefore] = await Promise.all([
      loadApplicableExceptions(fleetId, generation),
      loadLedgerMap(fleetId),
    ])

    // A fault already known keeps its baseline (AI-classified) tier; one the
    // ledger knows keeps that; only a brand-new fault gets the provisional
    // deterministic tier.
    //
    // The deterministic severity engine (the same one the baseline scan uses)
    // decides every locked / inactive / exception tier, so a re-scan can never
    // disagree with the baseline; only codes no locked rule covers keep the
    // prior tier described above. Legacy baselines (tiered by the old AI pass)
    // are re-tiered in memory the same way.
    const severityContext: SeverityContext = { fleetId, generation, exceptions }
    const tierFor = (
      record: ScanFaultRecord,
      prior: ScanFaultRecord["severity"]
    ): ScanFaultRecord["severity"] =>
      resolveSeverity(
        classifyFaultSeverity(
          {
            canonicalKey: record.canonicalKey,
            pttStatus: record.pttStatus,
            ecuLabel: record.ecuLabel,
            description: record.description,
          },
          severityContext
        ),
        prior
      )
    const baselineRecords: ScanFaultRecord[] = baselineSnapshot.records.map(
      (record) => ({ ...record, severity: tierFor(record, record.severity) })
    )
    const baselineByKey = new Map(
      baselineRecords.map((record) => [record.canonicalKey, record])
    )
    const verificationRecords: ScanFaultRecord[] = rawRecords.map((record) => ({
      ...record,
      severity: tierFor(
        record,
        baselineByKey.get(record.canonicalKey)?.severity ??
          ledgerBefore.get(record.canonicalKey)?.latestSeverity ??
          record.severity
      ),
    }))

    const isException = (key: string) =>
      matchesApprovedException(exceptions, fleetId, generation, key)
    const toLedgerFault = (record: {
      canonicalKey: string
      ecuLabel: string
      description: string
      severity: ScanFaultRecord["severity"]
    }): LedgerScanFault => ({
      canonicalKey: record.canonicalKey,
      ecuLabel: record.ecuLabel,
      description: record.description,
      severity: record.severity,
      isApprovedException: isException(record.canonicalKey),
    })

    // A legacy baseline (no ledger rows yet) is committed first, at its own
    // scan time, so the ledger history starts from the real first sighting.
    let ledger = ledgerBefore
    let legacyBaselineLedgerPlan: ReturnType<typeof planLedgerCommit> | null = null
    if (baselineSnapshot.needsBackfill) {
      legacyBaselineLedgerPlan = planLedgerCommit({
        fleetId,
        scanId: baseline.id,
        now: baseline.scannedAt,
        activeFaults: baselineRecords
          .filter((record) => record.pttStatus === "ACTIVE")
          .map(toLedgerFault),
        existing: ledger,
      })
      ledger = applyUpserts(ledger, legacyBaselineLedgerPlan.upserts)
    }

    const activeVerification = verificationRecords.filter(
      (record) => record.pttStatus === "ACTIVE"
    )
    const bounceBackKeys = detectBounceBacks(
      ledger,
      activeVerification.map(toLedgerFault),
      now
    )
    const reconciliation = reconcileDiagnosticScans({
      fleetId,
      generation,
      baselineFaults: baselineRecords,
      verificationFaults: verificationRecords,
      exceptions,
      bounceBackKeys,
    })

    // ---- Pass 2 (VERIFICATION_AUDIT): forensic read of the verdict --------
    // Runs only after the deterministic reconciliation succeeded. An audit
    // failure never fails the verification: the scan is stored without one.
    let verificationAudit: PttVerificationAudit | null = null
    try {
      verificationAudit = await generateVerificationForensicAudit({
        openai,
        model,
        input: buildVerificationAuditInput(
          reconciliation.buckets,
          reconciliation.caseStatus,
          new Map(
            [...ledger].map(([key, entry]): [string, number] => [
              key,
              entry.reopenCount,
            ])
          )
        ),
      })
    } catch (auditError) {
      console.error(
        "[ptt-verification] forensic audit failed (verification continues without it):",
        auditError
      )
    }

    const counts = summarizePttFaults(activeVerification)

    // ---- Persist: session first (its id is needed), then one atomic batch -----
    const [verification] = await db
      .insert(pttDiagnosticSessionsTable)
      .values({
        fleetId,
        truckGeneration: generation,
        odometerKm:
          ocr.odometer_km != null && Number.isFinite(ocr.odometer_km) && ocr.odometer_km >= 0
            ? Math.round(ocr.odometer_km)
            : null,
        status: "SCANNED",
        overallSeverity: counts.overallSeverity,
        criticalCount: counts.criticalCount,
        calibrationCount: counts.calibrationCount,
        monitorCount: counts.monitorCount,
        negligibleCount: counts.negligibleCount,
        scannedBy: userId,
        caseId: baseline.caseId,
        scanRole: "VERIFICATION",
        parentScanId: baseline.id,
        headerItemCount: ocr.reported_dtc_list_count,
        extractedItemCount,
        isCompleteScan: completeness.isComplete,
        chassisIdOcr: ocr.chassis_id_ocr,
        workOrderOcr: ocr.work_order_ocr,
        productTimeOcr: ocr.product_time_ocr,
        imageHashes: hashes,
        caseStatus: reconciliation.caseStatus,
        reconciliationSummary: reconciliation.summary,
        verificationAudit,
        gateOverrides,
      })
      .returning({ id: pttDiagnosticSessionsTable.id })
    createdSessionId = verification.id

    const plan = planLedgerCommit({
      fleetId,
      scanId: verification.id,
      now,
      activeFaults: activeVerification.map(toLedgerFault),
      clearedFaults: reconciliation.buckets.CLEARED.map(toLedgerFault),
      existing: ledger,
    })

    const bucketByKey = new Map(
      reconciliation.faults.map((fault) => [fault.canonicalKey, fault.bucket])
    )
    const exceptionKeys = new Set(
      reconciliation.faults
        .filter((fault) => fault.isApprovedException)
        .map((fault) => fault.canonicalKey)
    )
    for (const record of verificationRecords) {
      if (isException(record.canonicalKey)) exceptionKeys.add(record.canonicalKey)
    }
    const rowOptions = {
      scanId: verification.id,
      bucketByKey,
      bounceBackKeys: plan.bounceBackKeys,
      exceptionKeys,
    }
    const extractedKeys = new Set(
      verificationRecords.map((record) => record.canonicalKey)
    )
    // Baseline faults that are gone but were not on the screenshots at all.
    const absentCleared = reconciliation.buckets.CLEARED.filter(
      (fault) => !extractedKeys.has(fault.canonicalKey)
    )
    const scanFaultRows = [
      ...toScanFaultRows(verificationRecords, rowOptions),
      ...absentCleared.map(
        (fault): typeof pttScanFaultsTable.$inferInsert => ({
          scanId: verification.id,
          canonicalKey: fault.canonicalKey,
          ecuLabel: fault.ecuLabel,
          dtcRaw: fault.dtcRaw,
          description: fault.description,
          pttStatus: "INACTIVE",
          severity: fault.severity,
          reconciliationBucket: "CLEARED",
          isBounceBack: false,
          isApprovedException: fault.isApprovedException,
          isExtracted: false,
          keyNeedsReview: false,
          keyReviewReason: null,
        })
      ),
    ]

    const caseClosed = reconciliation.caseStatus === "VERIFIED_CLOSED"
    const statements: BatchItem<"pg">[] = []
    if (baselineSnapshot.needsBackfill) {
      const backfillRows = toScanFaultRows(baselineRecords, {
        scanId: baseline.id,
        bucketByKey: new Map(),
        bounceBackKeys: legacyBaselineLedgerPlan?.bounceBackKeys ?? new Set(),
        exceptionKeys: new Set(
          baselineRecords
            .filter((record) => isException(record.canonicalKey))
            .map((record) => record.canonicalKey)
        ),
      })
      if (backfillRows.length > 0) {
        statements.push(db.insert(pttScanFaultsTable).values(backfillRows))
      }
      const legacyLedger = ledgerUpsertStatement(
        legacyBaselineLedgerPlan?.upserts ?? []
      )
      if (legacyLedger) statements.push(legacyLedger)
    }
    if (scanFaultRows.length > 0) {
      statements.push(db.insert(pttScanFaultsTable).values(scanFaultRows))
    }
    statements.push(
      db.insert(pttSessionAttachmentsTable).values(
        photos.map((photo) => ({
          sessionId: verification.id,
          role: "VERIFICATION_SCAN" as const,
          fileName: photo.fileName,
          blobPathname: photo.blobPathname,
          blobUrl: photo.blobUrl,
          contentType: photo.contentType,
          fileSize: photo.fileSize,
        }))
      )
    )
    const ledgerStatement = ledgerUpsertStatement(plan.upserts)
    if (ledgerStatement) statements.push(ledgerStatement)
    statements.push(
      db
        .update(pttDiagnosticSessionsTable)
        .set({
          caseStatus: reconciliation.caseStatus,
          reconciliationSummary: reconciliation.summary,
          status: caseClosed ? "VERIFIED_CLOSED" : "IN_PROGRESS",
          verifiedAt: caseClosed ? now : null,
          updatedAt: now,
        })
        .where(eq(pttDiagnosticSessionsTable.id, baseline.id))
    )
    const [firstStatement, ...restStatements] = statements
    await db.batch([firstStatement, ...restStatements])
    committed = true

    if (gateOverrides.length > 0) {
      console.warn(
        `[ptt-verification] integrity gate override on ${fleetId} (scan ${verification.id}):`,
        JSON.stringify(gateOverrides)
      )
    }

    const updated = await querySessionDetail(baseline.id)
    if (!updated) throw new PttPipelineError("Session not found", 404)

    revalidatePath("/diagnostics")
    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error("[ptt-verification] verification failed:", error)

    // Roll back: no verification row and no orphaned screenshots.
    if (createdSessionId !== null && !committed) {
      await db
        .delete(pttDiagnosticSessionsTable)
        .where(eq(pttDiagnosticSessionsTable.id, createdSessionId))
        .catch((cleanupError) =>
          console.error("[ptt-verification] session rollback failed:", cleanupError)
        )
    }
    if (!committed) {
      await del(input.attachments.map((a) => a.blobPathname)).catch(
        (cleanupError) =>
          console.error("[ptt-verification] blob cleanup failed:", cleanupError)
      )
    }

    if (error instanceof PttPipelineError) {
      return fail(error.message, error.status, error.code, error.details)
    }
    return fail("Verification failed. Please try again.", 500)
  }
}
