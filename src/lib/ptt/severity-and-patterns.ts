import type {
  PttFault,
  PttFaultSeverity,
  PttTruckGeneration,
} from "../ptt-diagnostics"
import { fallbackSeverityForUnit } from "../ptt-ocr-pipeline"
import type { PttScanFaultStatus } from "./constants"
import { matchesApprovedException, type ApprovedExceptionRule } from "./reconcile"
import {
  buildScanKeyContext,
  canonicalKeyFor,
  toScanFaultStatus,
} from "./scan-faults"

// Deterministic severity + fleet-pattern engine. Runs between Pass 1 (vision
// OCR) and Pass 2 (the LLM directive) on BOTH baseline scans and post-work
// verification scans, so the two always agree on a fault's tier and the model
// never decides (or fluctuates) severity. Pure: no I/O, no clock, no DB.
//
// Keys are the canonical keys of `canonical-key.ts`:
//   FH V3: MID{mid}|{PID|PPID|SID|PSID}{n}|FMI{fmi}   e.g. MID128|PID175|FMI5
//   FH V4: {ECU}|{DTC}                                e.g. EMS|P111D00
// In the rule tables below `*` is a wildcard (`FMI*` = any FMI, `MID146|*` =
// anything on that MID).

// ---------------------------------------------------------------------------
// Locked rule tables
// ---------------------------------------------------------------------------

/** Locked CALIBRATION keys (stored as `CALIBRATION_ONLY`). */
export const LOCKED_CALIBRATION_KEYS: readonly string[] = [
  // FH V4
  "DDM|B150254", // Driver door module: 10 s cab window switch reset
  "CCIOM|C10F054", // Battery sensor calibration
  "EBS|C006154", // Lateral acceleration sensor calibration (level ground)
  // FH V3
  "MID223|SID253|FMI2", // Gear selector EEPROM
]

/** Any FH V4 DTC ending in `54` is a "Missing Calibration" subtype. */
const V4_MISSING_CALIBRATION_KEY = /^[A-Z0-9]+\|[PCBU][0-9A-F]{4}54$/

/** Locked CRITICAL keys / patterns. */
export const LOCKED_CRITICAL_PATTERNS: readonly string[] = [
  // FH V3 engine protection & fuel
  "MID128|PID175|FMI*", // engine oil temperature
  "MID128|PID94|FMI*", // fuel delivery pressure
  "MID128|PID110|FMI*", // coolant temperature
  "MID128|PID100|FMI*", // oil pressure
  // FH V3 gearbox / air / clutch
  "MID130|PID37|FMI1", // transmission tank air pressure
  "MID130|PSID27|FMI*", // I-Shift clutch system
  "MID130|PID160|FMI*", // main shaft speed
  // FH V3 brakes / ABS / road safety (every MID 136 brake-ECU fault)
  "MID136|SID1|FMI*",
  "MID136|SID2|FMI*",
  "MID136|*",
  "MID140|PID118|FMI*", // secondary brake air pressure
  "MID216|*|FMI6", // active short to ground on the LCM
  // FH V3 road speed & starter
  "MID144|PID84|FMI2",
  "MID128|PID84|FMI9",
  "MID144|PPID3|FMI4", // starter output
  // FH V4 engine / brakes / gearbox
  "EMS|P255613",
  "EMS|P255800",
  "EMS|P111D00",
  "ABS|C100201",
  "TECU|*",
  "VMCU|U300A62",
]

/** Wheel-speed-sensor wording on an FH V4 ABS / EBS row (electrical fault). */
const WHEEL_SPEED_SENSOR_DESCRIPTION = /wheel\s*(speed\s*)?sensor|wheel\s*speed/i

/** Locked MONITOR keys / patterns (never escalated to CRITICAL). */
export const LOCKED_MONITOR_PATTERNS: readonly string[] = [
  // FH V3
  "MID128|SID18|FMI5", // water-in-fuel drain valve
  "MID128|PID153|FMI5", // crankcase pressure
  "MID128|PID107|FMI5", // air filter pressure drop
  "MID128|PID173|FMI5", // exhaust gas temperature
  "MID128|PPID124|FMI5", // EPG 1
  "MID130|PSID20|FMI5", // PTO #1 VAP1
  "MID130|PSID208|FMI9", // MID 150 ECS
  "MID140|PID171|FMI5",
  "MID128|PID171|FMI*", // ambient temperature
  "MID140|PID96|FMI5", // fuel level
  "MID140|PSID45|FMI*",
  "MID140|PSID46|FMI*",
  "MID140|PSID47|FMI*",
  "MID146|*", // cab A/C (ECC)
  "MID216|*|FMI4", // bulb / dimmer codes
  "MID216|*|FMI5",
  // FH V4
  "APM|C101068", // air-dryer desiccant counter
  "EMS|P101713", // water-in-fuel drain valve
  "EMS|P10F800", // air filter clogged (operational check)
  "CIOM|B151095",
  "CIOM|U114E87",
  "CCIOM|U114187",
  "HMIIOM|U10A500",
  "RCIOM|C10D616",
]

const patternCache = new Map<string, RegExp | null>()

function compilePattern(pattern: string): RegExp | null {
  const cached = patternCache.get(pattern)
  if (cached !== undefined) return cached
  const regex = pattern.includes("*")
    ? new RegExp(
        `^${pattern
          .split("*")
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*")}$`
      )
    : null
  patternCache.set(pattern, regex)
  return regex
}

/** True when `key` equals `pattern` (exact, or `*` as a wildcard). */
export function matchesKeyPattern(key: string, pattern: string): boolean {
  const regex = compilePattern(pattern)
  return regex ? regex.test(key) : key === pattern
}

const matchesAny = (key: string, patterns: readonly string[]) =>
  patterns.some((pattern) => matchesKeyPattern(key, pattern))

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

export type SeveritySource =
  | "INACTIVE"
  | "APPROVED_EXCEPTION"
  | "LOCKED_CALIBRATION"
  | "LOCKED_CRITICAL"
  | "LOCKED_MONITOR"
  | "FALLBACK"

export type SeverityFaultInput = {
  canonicalKey: string
  pttStatus: PttScanFaultStatus
  /** Control unit as printed (used only by the fallback rule). */
  ecuLabel?: string
  /** Fault description (used only to spot FH V4 wheel-speed-sensor rows). */
  description?: string
}

export type SeverityContext = {
  fleetId: string
  generation: PttTruckGeneration
  exceptions: readonly ApprovedExceptionRule[]
}

export type SeverityDecision = {
  severity: PttFaultSeverity
  source: SeveritySource
  /** True when an active approved exception covers the key (any status). */
  isApprovedException: boolean
  /** Short audit explanation of the rule that decided the tier. */
  reason: string
}

function isV4WheelSpeedSensorFault(input: SeverityFaultInput): boolean {
  const ecu = input.canonicalKey.split("|")[0]
  return (
    (ecu === "ABS" || ecu === "EBS") &&
    WHEEL_SPEED_SENSOR_DESCRIPTION.test(input.description ?? "")
  )
}

/**
 * The one place a fault's tier is decided. Precedence (first match wins):
 *  1. INACTIVE                          -> NEGLIGIBLE
 *  2. active approved exception         -> NEGLIGIBLE (`isApprovedException`)
 *  3. locked CALIBRATION keys + V4 `...54` -> CALIBRATION_ONLY
 *  4. locked CRITICAL keys / patterns   -> CRITICAL
 *  5. locked MONITOR keys / patterns    -> MONITOR
 *  6. anything else                     -> the existing deterministic fallback
 *     (active fault on a safety ECU = CRITICAL, other active = MONITOR)
 */
export function classifyFaultSeverity(
  input: SeverityFaultInput,
  context: SeverityContext
): SeverityDecision {
  const { canonicalKey } = input
  const isApprovedException = matchesApprovedException(
    context.exceptions,
    context.fleetId,
    context.generation,
    canonicalKey
  )

  if (input.pttStatus === "INACTIVE") {
    return {
      severity: "NEGLIGIBLE",
      source: "INACTIVE",
      isApprovedException,
      reason: "Inactive fault: historical only.",
    }
  }
  if (isApprovedException) {
    return {
      severity: "NEGLIGIBLE",
      source: "APPROVED_EXCEPTION",
      isApprovedException,
      reason: "Approved exception: no action required.",
    }
  }
  if (
    LOCKED_CALIBRATION_KEYS.includes(canonicalKey) ||
    V4_MISSING_CALIBRATION_KEY.test(canonicalKey)
  ) {
    return {
      severity: "CALIBRATION_ONLY",
      source: "LOCKED_CALIBRATION",
      isApprovedException,
      reason: "Missing calibration: run the PTT calibration routine, no parts.",
    }
  }
  if (
    matchesAny(canonicalKey, LOCKED_CRITICAL_PATTERNS) ||
    isV4WheelSpeedSensorFault(input)
  ) {
    return {
      severity: "CRITICAL",
      source: "LOCKED_CRITICAL",
      isApprovedException,
      reason: "Locked CRITICAL fault (safety / drivability / engine protection).",
    }
  }
  if (matchesAny(canonicalKey, LOCKED_MONITOR_PATTERNS)) {
    return {
      severity: "MONITOR",
      source: "LOCKED_MONITOR",
      isApprovedException,
      reason: "Locked MONITOR fault: never escalated to CRITICAL.",
    }
  }

  // A failed VCADS operation is a mechanical / pneumatic fault until proven
  // otherwise (same default the verification route has always used).
  if (canonicalKey.startsWith("VCADS|")) {
    return {
      severity: "CRITICAL",
      source: "FALLBACK",
      isApprovedException,
      reason: "Failed VCADS operation: CRITICAL until the check is completed.",
    }
  }

  return {
    severity: fallbackSeverityForUnit(input.ecuLabel ?? "", "ACTIVE"),
    source: "FALLBACK",
    isApprovedException,
    reason: "No locked rule: deterministic fallback tier.",
  }
}

const APPROVED_EXCEPTION_SUMMARY =
  "Approved exception - no action required."

/**
 * Re-tiers Pass 2's classified faults with the engine so the LLM can never
 * move a tier: severity and `calibration_required` come from the decision, and
 * an approved exception's root-cause text is replaced with a fixed
 * "no action" line (exceptions stay silent).
 */
export function applyDeterministicSeverity(
  faults: readonly PttFault[],
  context: SeverityContext
): PttFault[] {
  const scanContext = buildScanKeyContext(
    faults.map((fault) => ({
      controlUnit: fault.control_unit,
      faultCode: fault.fault_code,
      description: fault.component_description,
    })),
    context.generation
  )
  return faults.map((fault) => {
    const decision = classifyFaultSeverity(
      {
        canonicalKey: canonicalKeyFor(
          fault.control_unit,
          fault.fault_code,
          context.generation,
          fault.component_description,
          scanContext
        ),
        pttStatus: toScanFaultStatus(fault.fault_state),
        ecuLabel: fault.control_unit,
        description: fault.component_description,
      },
      context
    )
    return {
      ...fault,
      severity: decision.severity,
      calibration_required: decision.severity === "CALIBRATION_ONLY",
      root_cause_summary: decision.isApprovedException
        ? APPROVED_EXCEPTION_SUMMARY
        : fault.root_cause_summary,
    }
  })
}

/**
 * The severity to store for a fault: the engine's tier for every locked /
 * INACTIVE / exception decision, and `fallbackSeverity` (the caller's own
 * prior tier, e.g. the baseline's) only when no locked rule applied.
 */
export function resolveSeverity(
  decision: SeverityDecision,
  fallbackSeverity: PttFaultSeverity
): PttFaultSeverity {
  return decision.source === "FALLBACK" ? fallbackSeverity : decision.severity
}

// ---------------------------------------------------------------------------
// Fleet pattern flags
// ---------------------------------------------------------------------------

export const FLEET_PATTERN_FLAGS = [
  "isLcmOffline",
  "retarderClusterOpen",
  "absToGearboxRipple",
  "roadSpeedPair",
  "vmcuKeyToApmRipple",
  "mid128OpenCluster",
  "singleSideLightingFault",
] as const
export type FleetPatternFlag = (typeof FLEET_PATTERN_FLAGS)[number]

export type FleetPatternFlags = Record<FleetPatternFlag, boolean>

export type PatternFault = {
  canonicalKey: string
  pttStatus: PttScanFaultStatus
  description?: string
  /** Approved exceptions never count towards a pattern. */
  isApprovedException?: boolean
}

const ACM_RETARDER_OPEN_KEYS = [
  "ACM|P107B13",
  "ACM|P107C13",
  "ACM|P107D13",
  "ACM|P107E13",
] as const

const MID222_FMI5 = /^MID222\|[A-Z]+\d+\|FMI5$/
const MID128_FMI5 = /^MID128\|[A-Z]+\d+\|FMI5$/
const MID216_KEY = /^MID216\|/
const MID136_KEY = /^MID136\|/

const HIGH_BEAM = /high\s*beam/i
const LEFT_SIDE = /\b(left|lh)\b/i
const RIGHT_SIDE = /\b(right|rh)\b/i

/**
 * Deterministic fleet-context flags computed from one scan's faults. Only
 * ACTIVE, non-exception faults take part (except `isLcmOffline`, which also
 * needs to know that the scan has no MID 216 row at all).
 */
export function detectFleetPatterns(
  faults: readonly PatternFault[]
): FleetPatternFlags {
  const active = faults.filter(
    (fault) => fault.pttStatus === "ACTIVE" && !fault.isApprovedException
  )
  const activeKeys = new Set(active.map((fault) => fault.canonicalKey))
  const countActive = (predicate: (key: string) => boolean) =>
    [...activeKeys].filter(predicate).length

  const isLcmOffline =
    activeKeys.has("MID140|PSID210|FMI12") &&
    !faults.some((fault) => MID216_KEY.test(fault.canonicalKey))

  const retarderClusterOpen =
    ACM_RETARDER_OPEN_KEYS.filter((key) => activeKeys.has(key)).length >= 3 ||
    countActive((key) => MID222_FMI5.test(key)) >= 3

  const absToGearboxRipple =
    activeKeys.has("MID130|PSID204|FMI8") &&
    countActive((key) => MID136_KEY.test(key)) > 0

  const roadSpeedPair =
    activeKeys.has("MID144|PID84|FMI2") && activeKeys.has("MID128|PID84|FMI9")

  const vmcuKeyToApmRipple =
    activeKeys.has("VMCU|U300A62") && activeKeys.has("APM|U002886")

  const mid128OpenCluster = countActive((key) => MID128_FMI5.test(key)) >= 3

  // Brake lamps: PSID 10 vs PSID 11 (one side faulting, the other clean).
  const brakeLampSides = [
    countActive((key) => /^MID216\|PSID10\|FMI\d+$/.test(key)) > 0,
    countActive((key) => /^MID216\|PSID11\|FMI\d+$/.test(key)) > 0,
  ]
  const brakeLampOneSided = brakeLampSides[0] !== brakeLampSides[1]

  // High beams: identified from the printed description (left / right).
  const highBeamRows = active.filter(
    (fault) =>
      MID216_KEY.test(fault.canonicalKey) &&
      HIGH_BEAM.test(fault.description ?? "")
  )
  const highBeamLeft = highBeamRows.some((f) => LEFT_SIDE.test(f.description ?? ""))
  const highBeamRight = highBeamRows.some((f) =>
    RIGHT_SIDE.test(f.description ?? "")
  )
  const highBeamOneSided = highBeamLeft !== highBeamRight

  return {
    isLcmOffline,
    retarderClusterOpen,
    absToGearboxRipple,
    roadSpeedPair,
    vmcuKeyToApmRipple,
    mid128OpenCluster,
    singleSideLightingFault: brakeLampOneSided || highBeamOneSided,
  }
}

/** The instruction Pass 2 must honour when a flag is set. */
export const FLEET_PATTERN_MANDATES: Readonly<Record<FleetPatternFlag, string>> =
  {
    isLcmOffline:
      "The LCM (MID 216) reports no rows while the cluster (MID 140) logs PSID 210 FMI 12: the LCM is OFFLINE. Include a physical exterior-lights walk-around (brake lamps, turn signals, headlights) in physicalChecks before any part is ordered.",
    retarderClusterOpen:
      "3+ retarder circuits read open at once. Inspect the SINGLE main rear-gearbox retarder connector, or confirm a non-retarder gearbox swap. Never diagnose this as 3-4 bad sensors.",
    absToGearboxRipple:
      "MID 130 PSID 204 FMI 8 is an automatic RIPPLE of the active MID 136 ABS wheel-sensor fault. Fix the ABS sensor first; do NOT trace the CAN bus.",
    roadSpeedPair:
      "MID 144 PID 84 FMI 2 and MID 128 PID 84 FMI 9 are ONE root cause: the gearbox tailshaft speed sensor or its wiring. Treat them as a single check.",
    vmcuKeyToApmRipple:
      "VMCU U300A62 with APM U002886 is a ripple. Inspect the ignition switch and any aftermarket GPS-tracker splices at the VMCU BEFORE touching the APM.",
    mid128OpenCluster:
      "3+ MID 128 FMI 5 codes are active. Inspect the shared engine-side harness and connector seating BEFORE ordering any individual sensor.",
    singleSideLightingFault:
      "Only one side of a lamp pair (brake lamp PSID 10 vs 11, or one high beam) is faulting while the opposite side is clean: most likely a blown bulb or socket, NOT the aftermarket LED type.",
  }

export type FleetPatternPayload = {
  flags: FleetPatternFlags
  /** One mandatory instruction per TRUE flag. */
  activeMandates: Array<{ flag: FleetPatternFlag; mandate: string }>
}

/** The `fleetPatterns` block of the Pass 2 user payload. */
export function buildFleetPatternPayload(
  flags: FleetPatternFlags
): FleetPatternPayload {
  return {
    flags,
    activeMandates: FLEET_PATTERN_FLAGS.filter((flag) => flags[flag]).map(
      (flag) => ({ flag, mandate: FLEET_PATTERN_MANDATES[flag] })
    ),
  }
}
