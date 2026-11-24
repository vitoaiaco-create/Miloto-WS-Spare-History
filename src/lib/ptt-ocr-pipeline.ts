import type {
  PttFault,
  PttFaultSeverity,
  PttRawRow,
  PttVcadsPopup,
} from "@/lib/ptt-diagnostics"

// Pure helpers for the 2-pass PTT analysis pipeline (see
// `/api/diagnostics/analyze`): deduplicate + number the Pass 1 OCR rows, then
// prove that Pass 2 classified every one of them (and every VCADS pop-up),
// appending deterministic fallback entries for anything it dropped.

export type NumberedRawRow = PttRawRow & {
  /** 1-based row number shown to Pass 2 as `#n`. */
  n: number
}

export type NumberedVcadsPopup = PttVcadsPopup & {
  /** Digits of the operation, e.g. "37"; `null` when not readable. */
  opNumber: string | null
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

const alnum = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "")

function midOf(controlUnit: string): string | null {
  return /MID\s*0*(\d+)/i.exec(controlUnit)?.[1] ?? null
}

// ECUs compare by MID number when printed (so "ECC ECU (MID 146)" and
// "ECC ECU  ( MID 146 )" match), else by their alphanumeric text.
function unitKey(controlUnit: string): string {
  const mid = midOf(controlUnit)
  return mid ? `MID${mid}` : alnum(controlUnit)
}

function digitSignature(code: string): string {
  return (code.match(/\d+/g) ?? []).join("-")
}

function rowKey(row: PttRawRow): string {
  return `${unitKey(row.control_unit_verbatim)}|${alnum(row.fault_code_verbatim)}`
}

// ---------------------------------------------------------------------------
// Pass 1 deduplication + numbering
// ---------------------------------------------------------------------------

const isKnownState = (row: PttRawRow) =>
  row.fault_state === "ACTIVE" || row.fault_state === "INACTIVE"

// True when `candidate` should replace `current`: known ACTIVE / INACTIVE
// state first, then the fullest description, then the higher count.
function isBetterRow(candidate: PttRawRow, current: PttRawRow): boolean {
  const knownDelta = Number(isKnownState(candidate)) - Number(isKnownState(current))
  if (knownDelta !== 0) return knownDelta > 0
  const descDelta =
    candidate.description_verbatim.trim().length -
    current.description_verbatim.trim().length
  if (descDelta !== 0) return descDelta > 0
  return (candidate.occurrence_count ?? 0) > (current.occurrence_count ?? 0)
}

/**
 * Deduplicates OCR rows from overlapping scrolled screenshots by normalised
 * `(control unit + fault code)` and numbers the survivors `#1..#N` in first-seen
 * order. Rows with an empty code are dropped (nothing to classify).
 */
export function dedupeAndNumberRawRows(rows: PttRawRow[]): NumberedRawRow[] {
  const byKey = new Map<string, PttRawRow>()
  for (const raw of rows) {
    const row: PttRawRow = {
      ...raw,
      control_unit_verbatim: raw.control_unit_verbatim.trim(),
      fault_code_verbatim: raw.fault_code_verbatim.trim(),
      description_verbatim: raw.description_verbatim.trim(),
    }
    if (!alnum(row.fault_code_verbatim)) continue

    const key = rowKey(row)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, row)
      continue
    }

    const winner = isBetterRow(row, existing) ? row : existing
    const loser = winner === row ? existing : row
    byKey.set(key, {
      ...winner,
      description_verbatim:
        winner.description_verbatim || loser.description_verbatim,
      occurrence_count:
        Math.max(winner.occurrence_count ?? 0, loser.occurrence_count ?? 0) ||
        winner.occurrence_count,
      // Never let a scrolled duplicate hide a live fault.
      fault_state:
        winner.fault_state !== "ACTIVE" && loser.fault_state === "ACTIVE"
          ? "ACTIVE"
          : winner.fault_state,
    })
  }
  return [...byKey.values()].map((row, index) => ({ ...row, n: index + 1 }))
}

const popupOpNumber = (popup: PttVcadsPopup): string | null =>
  /\d+/.exec(popup.operation_code)?.[0] ??
  /Operations?:?\s*(\d+)/i.exec(popup.message)?.[1] ??
  null

/** Deduplicates VCADS pop-ups by operation number (or message when unreadable). */
export function dedupeVcadsPopups(
  popups: PttVcadsPopup[]
): NumberedVcadsPopup[] {
  const byKey = new Map<string, NumberedVcadsPopup>()
  for (const popup of popups) {
    const opNumber = popupOpNumber(popup)
    const key = opNumber ?? `MSG:${alnum(popup.message)}`
    const existing = byKey.get(key)
    if (
      !existing ||
      popup.message.trim().length > existing.message.trim().length
    ) {
      byKey.set(key, { ...popup, opNumber })
    }
  }
  return [...byKey.values()]
}

export function vcadsFaultCode(popup: NumberedVcadsPopup): string {
  return `VCADS-OP-${popup.opNumber ?? "UNKNOWN"}`
}

// ---------------------------------------------------------------------------
// Pass 2 prompt input
// ---------------------------------------------------------------------------

export function formatNumberedFaultList(rows: NumberedRawRow[]): string {
  if (rows.length === 0) return "(no DTC rows were transcribed)"
  return rows
    .map(
      (r) =>
        `#${r.n} | ${r.control_unit_verbatim || "(unit not readable)"} | ${r.fault_code_verbatim} | ${r.code_format} | ${r.description_verbatim || "(no description)"} | ${r.fault_state} | count ${r.occurrence_count ?? "n/a"}`
    )
    .join("\n")
}

export function formatVcadsPopupList(popups: NumberedVcadsPopup[]): string {
  if (popups.length === 0) return "(no VCADS pop-ups)"
  return popups
    .map(
      (p) =>
        `${vcadsFaultCode(p)} | target system: ${p.target_system || "unknown"} | message: ${p.message} | background: ${p.background_context || "n/a"}`
    )
    .join("\n")
}

// ---------------------------------------------------------------------------
// Pass 2 coverage safety net
// ---------------------------------------------------------------------------

/**
 * Returns the numbered Pass 1 rows that no Pass 2 fault accounts for. A fault
 * accounts for a row when it echoes its `source_row`, or - if the model left
 * that out - when its unit + code (exact, then digits-only, then a unique
 * code) matches a still-uncovered row. Each fault covers at most one row.
 */
export function findUncoveredRows(
  rows: NumberedRawRow[],
  faults: PttFault[]
): NumberedRawRow[] {
  const covered = new Set<number>()
  const validRows = new Set(rows.map((r) => r.n))

  const unclaimed: PttFault[] = []
  for (const fault of faults) {
    if (fault.source_row != null && validRows.has(fault.source_row)) {
      covered.add(fault.source_row)
    } else {
      unclaimed.push(fault)
    }
  }

  const codeCounts = new Map<string, number>()
  for (const r of rows) {
    const code = alnum(r.fault_code_verbatim)
    codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1)
  }

  for (const fault of unclaimed) {
    const code = alnum(fault.fault_code)
    const digits = digitSignature(fault.fault_code)
    const unit = unitKey(fault.control_unit)
    const open = rows.filter((r) => !covered.has(r.n))

    const match =
      open.find(
        (r) => alnum(r.fault_code_verbatim) === code && unitKey(r.control_unit_verbatim) === unit
      ) ??
      open.find(
        (r) =>
          digits !== "" &&
          digitSignature(r.fault_code_verbatim) === digits &&
          unitKey(r.control_unit_verbatim) === unit
      ) ??
      open.find(
        (r) =>
          alnum(r.fault_code_verbatim) === code && codeCounts.get(code) === 1
      )
    if (match) covered.add(match.n)
  }

  return rows.filter((r) => !covered.has(r.n))
}

/** VCADS pop-ups with no matching `VCADS-OP-<n>` entry in the Pass 2 faults. */
export function findUncoveredPopups(
  popups: NumberedVcadsPopup[],
  faults: PttFault[]
): NumberedVcadsPopup[] {
  const vcadsCodes = faults
    .map((f) => f.fault_code.trim().toUpperCase())
    .filter((code) => code.startsWith("VCADS"))
  const known = new Set(
    vcadsCodes.map((code) => /VCADS-?OP-?(\d+)/.exec(code)?.[1]).filter(Boolean)
  )
  const unreadableCovered = vcadsCodes.length >= popups.length

  return popups.filter((p) =>
    p.opNumber ? !known.has(p.opNumber) : !unreadableCovered
  )
}

// Engine, gearbox, brake, vehicle and air-production ECUs: an ACTIVE fault
// here must never be silently downgraded when Pass 2 dropped the row.
const SAFETY_MIDS = new Set(["128", "130", "136", "144", "185"])

function fallbackSeverity(row: PttRawRow): PttFaultSeverity {
  if (row.fault_state === "ACTIVE") {
    const mid = midOf(row.control_unit_verbatim)
    return mid && SAFETY_MIDS.has(mid) ? "CRITICAL" : "MONITOR"
  }
  return row.fault_state === "INACTIVE" ? "NEGLIGIBLE" : "MONITOR"
}

// Cab air-conditioning ECU: Electronic Climate Control (ECC, MID 146). Comfort
// only - it can never stop a truck from working.
function isCabClimateUnit(controlUnit: string): boolean {
  return midOf(controlUnit) === "146" || /\bECC\b/i.test(controlUnit)
}

/**
 * Deterministic clamp behind the prompt rule "NEVER classify cab A/C faults
 * as CRITICAL": any ECC / MID 146 fault the model still tiered CRITICAL is
 * downgraded to MONITOR (with an audit note on its root cause). Run it before
 * computing the tier counts and the overall severity.
 */
export function clampCabClimateSeverity(faults: PttFault[]): PttFault[] {
  return faults.map((fault) => {
    if (fault.severity !== "CRITICAL" || !isCabClimateUnit(fault.control_unit)) {
      return fault
    }
    return {
      ...fault,
      severity: "MONITOR",
      root_cause_summary: [
        fault.root_cause_summary.trim(),
        "[Auto-downgraded from CRITICAL to MONITOR: cab A/C (ECC / MID 146) is comfort-only and never a stop-work fault.]",
      ]
        .filter(Boolean)
        .join(" "),
    }
  })
}

/** Fallback entry for a Pass 1 row that Pass 2 failed to classify. */
export function fallbackFaultFromRow(row: NumberedRawRow): PttFault {
  return {
    fault_code: row.fault_code_verbatim.toUpperCase(),
    code_format: row.code_format,
    control_unit: row.control_unit_verbatim || "UNKNOWN ECU",
    component_description: row.description_verbatim,
    fault_state: row.fault_state,
    occurrence_count: row.occurrence_count,
    severity: fallbackSeverity(row),
    root_cause_summary:
      "Auto-appended from the screenshot transcription: the diagnostic engine returned no classification for this row. Tier is a conservative default - review manually against PTT Live Data before approving any parts.",
    calibration_required: false,
    source_row: row.n,
  }
}

/** Fallback entry for a VCADS pop-up that Pass 2 failed to classify. */
export function fallbackFaultFromPopup(popup: NumberedVcadsPopup): PttFault {
  return {
    fault_code: vcadsFaultCode(popup),
    code_format: "OTHER",
    control_unit: popup.target_system.trim() || "VCADS",
    component_description: popup.message.trim(),
    fault_state: "ACTIVE",
    occurrence_count: null,
    severity: "CRITICAL",
    root_cause_summary:
      "Auto-appended from the screenshot transcription: the VCADS operation failed on screen and the diagnostic engine returned no classification. Treated as CRITICAL until a mechanical-vs-pneumatic check (air pressure / leakage, sensor gap, actuator stroke) is completed in PTT Live Data.",
    calibration_required: false,
    source_row: null,
  }
}
