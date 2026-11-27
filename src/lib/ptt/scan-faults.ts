import type {
  PttFaultSeverity,
  PttFaultState,
  PttTruckGeneration,
} from "../ptt-diagnostics"
import {
  EMPTY_SCAN_CONTEXT,
  buildCanonicalKey,
  validateCanonicalKey,
  type CanonicalKeyScanContext,
} from "./canonical-key"
import type { PttScanFaultStatus } from "./constants"

// Pure conversion of extracted PTT rows into the immutable `ptt_scan_faults`
// snapshot: one record per canonical key, with unreadable keys flagged for
// review instead of silently breaking the set diff.

export type ExtractedFaultInput = {
  controlUnit: string
  faultCode: string
  description: string
  faultState: PttFaultState
  severity: PttFaultSeverity
}

export type ScanFaultRecord = {
  canonicalKey: string
  ecuLabel: string
  dtcRaw: string
  description: string
  pttStatus: PttScanFaultStatus
  severity: PttFaultSeverity
  keyNeedsReview: boolean
  keyReviewReason: string | null
  /** A VCADS pop-up entry (not a row of the DTC List). */
  isVcads: boolean
}

const SEVERITY_ORDER: Record<PttFaultSeverity, number> = {
  CRITICAL: 4,
  CALIBRATION_ONLY: 3,
  MONITOR: 2,
  NEGLIGIBLE: 1,
}

/** UNKNOWN (unreadable) states are kept ACTIVE so they are never credited as cleared. */
export function toScanFaultStatus(state: PttFaultState): PttScanFaultStatus {
  return state === "INACTIVE" ? "INACTIVE" : "ACTIVE"
}

const VCADS_CODE = /^VCADS-?OP-?(\d+|UNKNOWN)$/

// A VCADS pop-up that reports success counts as resolved. Conservative: any
// failure wording wins, and anything ambiguous stays ACTIVE.
export function isVcadsSuccessMessage(message: string): boolean {
  const text = message.toLowerCase()
  const failed = /\b(fail|failed|failure|error|not\s+(?:completed|successful|passed)|unable|abort|aborted|incomplete|cancel)/.test(
    text
  )
  const succeeded = /\b(completed|successful|successfully|passed|finished)\b/.test(
    text
  )
  return succeeded && !failed
}

/**
 * The canonical key one extracted row / fault entry will be stored under
 * (the same rules as `buildScanFaultRecords`): `VCADS|OP{n}` for pop-ups, the
 * built V3 / V4 key, or the deterministic `UNVERIFIED|...` stand-in when the
 * row cannot be normalised.
 */
export function canonicalKeyFor(
  controlUnit: string,
  faultCode: string,
  generation: PttTruckGeneration,
  /** The row's description; unlocks the description-guarded OCR rescues. */
  description = "",
  scanContext: CanonicalKeyScanContext = EMPTY_SCAN_CONTEXT
): string {
  const vcads = VCADS_CODE.exec(faultCode.trim().toUpperCase().replace(/\s+/g, ""))
  if (vcads) return `VCADS|OP${vcads[1]}`
  const built = buildCanonicalKey({
    controlUnit,
    faultCode,
    description,
    scanContext,
    generation: generation === "UNKNOWN" ? undefined : generation,
  })
  return built.ok ? built.key : built.fallbackKey
}

/** The printed fields of one row, as the scan-level normalisation needs them. */
export type ScanRowText = {
  controlUnit: string
  faultCode: string
  description: string
}

/**
 * Scan-level normalisation context: facts about the OTHER rows of the same
 * scan that a row-level rescue needs. Today that is "does this scan hold a
 * Retarder (MID 222) fault", which resolves a cropped `Engine ECU` label on
 * `PID 110 FMI 5` to `MID222|PID110|FMI5`. Must be computed from the whole
 * scan (live extraction AND stored rows) BEFORE any row is keyed or diffed.
 * Only FH V3 scans can have it.
 */
export function buildScanKeyContext(
  rows: readonly ScanRowText[],
  generation: PttTruckGeneration
): CanonicalKeyScanContext {
  if (generation !== "FH_V3") return EMPTY_SCAN_CONTEXT
  const hasRetarderFault = rows.some((row) => {
    const built = buildCanonicalKey({
      controlUnit: row.controlUnit,
      faultCode: row.faultCode,
      description: row.description,
      generation,
    })
    return built.ok && built.key.startsWith("MID222|")
  })
  return { hasRetarderFault }
}

function recordFor(
  input: ExtractedFaultInput,
  generation: PttTruckGeneration,
  scanContext: CanonicalKeyScanContext
): ScanFaultRecord {
  const code = input.faultCode.trim().toUpperCase().replace(/\s+/g, "")
  const vcads = VCADS_CODE.exec(code)
  const base = {
    ecuLabel: input.controlUnit.trim(),
    dtcRaw: input.faultCode.trim(),
    description: input.description.trim(),
    pttStatus: toScanFaultStatus(input.faultState),
    severity: input.severity,
  }

  if (vcads) {
    const unreadable = vcads[1] === "UNKNOWN"
    return {
      ...base,
      canonicalKey: `VCADS|OP${vcads[1]}`,
      keyNeedsReview: unreadable,
      keyReviewReason: unreadable
        ? "VCADS operation number could not be read"
        : null,
      isVcads: true,
    }
  }

  const built = buildCanonicalKey({
    controlUnit: input.controlUnit,
    faultCode: input.faultCode,
    description: input.description,
    scanContext,
    generation: generation === "UNKNOWN" ? undefined : generation,
  })
  if (built.ok) {
    return {
      ...base,
      canonicalKey: built.key,
      keyNeedsReview: built.warnings.length > 0,
      keyReviewReason: built.warnings.length > 0 ? built.warnings.join("; ") : null,
      isVcads: false,
    }
  }
  return {
    ...base,
    canonicalKey: built.fallbackKey,
    keyNeedsReview: true,
    keyReviewReason: built.reason,
    isVcads: false,
  }
}

/**
 * Re-runs the canonical-key normaliser on a stored row (its printed ECU label
 * and DTC), so rows written with an older / weaker normaliser (e.g. an
 * `UNVERIFIED|...` stand-in for an OCR-garbled ECU) are repaired. Status,
 * severity and description are carried over; only the key and its review flag
 * can change.
 */
export function rekeyScanFaultRecord(
  record: ScanFaultRecord,
  generation: PttTruckGeneration,
  /**
   * Context of the scan the row belongs to (`buildScanKeyContext` over every
   * row of that scan); without it only the row-level rescues can fire.
   */
  scanContext: CanonicalKeyScanContext = EMPTY_SCAN_CONTEXT
): ScanFaultRecord {
  const [rebuilt] = buildScanFaultRecords(
    [
      {
        controlUnit: record.ecuLabel,
        faultCode: record.dtcRaw,
        description: record.description,
        faultState: record.pttStatus,
        severity: record.severity,
      },
    ],
    generation,
    scanContext
  )
  return rebuilt ?? record
}

/** The row text `buildScanKeyContext` needs from stored records. */
export const scanRowTextOf = (
  record: Pick<ScanFaultRecord, "ecuLabel" | "dtcRaw" | "description">
): ScanRowText => ({
  controlUnit: record.ecuLabel,
  faultCode: record.dtcRaw,
  description: record.description,
})

/**
 * Builds one snapshot record per canonical key. Rows that normalise to the
 * same key are merged: ACTIVE wins, the worse severity wins and the fuller
 * description is kept, so a repeated screenshot row can never hide a live
 * fault and the `(scanId, canonicalKey)` unique index can never be violated.
 */
export function buildScanFaultRecords(
  inputs: readonly ExtractedFaultInput[],
  generation: PttTruckGeneration,
  /** Defaults to the context of `inputs` themselves (the whole scan). */
  scanContext: CanonicalKeyScanContext = buildScanKeyContext(
    inputs.map((input) => ({
      controlUnit: input.controlUnit,
      faultCode: input.faultCode,
      description: input.description,
    })),
    generation
  )
): ScanFaultRecord[] {
  const byKey = new Map<string, ScanFaultRecord>()
  for (const input of inputs) {
    const record = recordFor(input, generation, scanContext)
    const existing = byKey.get(record.canonicalKey)
    if (!existing) {
      byKey.set(record.canonicalKey, record)
      continue
    }
    byKey.set(record.canonicalKey, {
      ...existing,
      pttStatus:
        existing.pttStatus === "ACTIVE" || record.pttStatus === "ACTIVE"
          ? "ACTIVE"
          : "INACTIVE",
      severity:
        SEVERITY_ORDER[record.severity] > SEVERITY_ORDER[existing.severity]
          ? record.severity
          : existing.severity,
      description:
        record.description.length > existing.description.length
          ? record.description
          : existing.description,
      keyNeedsReview: existing.keyNeedsReview || record.keyNeedsReview,
      keyReviewReason: existing.keyReviewReason ?? record.keyReviewReason,
    })
  }
  return [...byKey.values()]
}

/**
 * Truck generation implied by the stored canonical keys (majority format), for
 * scans registered as UNKNOWN. Returns "UNKNOWN" when no key is conclusive.
 */
export function inferGenerationFromRecords(
  records: readonly Pick<ScanFaultRecord, "canonicalKey">[]
): PttTruckGeneration {
  let v3 = 0
  let v4 = 0
  for (const { canonicalKey } of records) {
    const { generation } = validateCanonicalKey(canonicalKey)
    if (generation === "FH_V3") v3 += 1
    else if (generation === "FH_V4") v4 += 1
  }
  if (v3 === v4) return "UNKNOWN"
  return v3 > v4 ? "FH_V3" : "FH_V4"
}

/** Distinct DTC List rows (VCADS pop-ups are not part of the header count). */
export function countExtractedDtcRows(records: readonly ScanFaultRecord[]): number {
  return records.filter((record) => !record.isVcads).length
}
