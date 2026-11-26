import type {
  PttFaultSeverity,
  PttFaultState,
  PttTruckGeneration,
} from "../ptt-diagnostics"
import { buildCanonicalKey, validateCanonicalKey } from "./canonical-key"
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
  generation: PttTruckGeneration
): string {
  const vcads = VCADS_CODE.exec(faultCode.trim().toUpperCase().replace(/\s+/g, ""))
  if (vcads) return `VCADS|OP${vcads[1]}`
  const built = buildCanonicalKey({
    controlUnit,
    faultCode,
    generation: generation === "UNKNOWN" ? undefined : generation,
  })
  return built.ok ? built.key : built.fallbackKey
}

function recordFor(
  input: ExtractedFaultInput,
  generation: PttTruckGeneration
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
 * Builds one snapshot record per canonical key. Rows that normalise to the
 * same key are merged: ACTIVE wins, the worse severity wins and the fuller
 * description is kept, so a repeated screenshot row can never hide a live
 * fault and the `(scanId, canonicalKey)` unique index can never be violated.
 */
export function buildScanFaultRecords(
  inputs: readonly ExtractedFaultInput[],
  generation: PttTruckGeneration
): ScanFaultRecord[] {
  const byKey = new Map<string, ScanFaultRecord>()
  for (const input of inputs) {
    const record = recordFor(input, generation)
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
