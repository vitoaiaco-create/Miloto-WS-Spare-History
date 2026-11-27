import type { PttKnownGeneration } from "./constants"

// Canonical fault keys for the Before/After reconciliation engine.
//
// Faults are NEVER matched on free-text descriptions. Every extracted DTC is
// normalised into an exact key before it is stored or diffed:
//   Volvo FH V3:  MID{mid}|{PID|PPID|SID|PSID}{n}|FMI{fmi}   e.g. MID128|PID175|FMI5
//   Volvo FH V4:  {ECU_ACRONYM}|{DTC}                        e.g. EMS|P111D00
// Pure, side-effect-free and client-safe.

export const V3_KEY_REGEX = /^MID\d+\|(PID|PPID|SID|PSID)\d+\|FMI\d+$/
export const V4_KEY_REGEX = /^[A-Z0-9]+\|[PCBU][0-9A-F]{6}$/

export const V4_ECU_ACRONYMS = [
  "EMS",
  "ACM",
  "APM",
  "ABS",
  "EBS",
  "CIOM",
  "CCIOM",
  "FCIOM",
  "RCIOM",
  "DDM",
  "HMIIOM",
  "CCM",
  "TECU",
  "VMCU",
  "PDM",
  "IC",
] as const
export type V4EcuAcronym = (typeof V4_ECU_ACRONYMS)[number]

const V4_ECU_SET: ReadonlySet<string> = new Set(V4_ECU_ACRONYMS)

// Spelled-out ECU names (when the acronym is not printed). Only names that map
// to exactly one acronym are listed; a bare "brake module" is ambiguous (ABS
// vs EBS) so it must be identified by its acronym or its full system name
// (see `V4_ECU_NAME_ALIASES`).
const V4_ECU_NAME_PATTERNS: ReadonlyArray<readonly [RegExp, V4EcuAcronym]> = [
  [/ENGINE\s+(CONTROL|MANAGEMENT)/, "EMS"],
  [/AFTER\s?TREATMENT/, "ACM"],
  [/AIR\s+PRODUCTION/, "APM"],
  [/TRANSMISSION\s+(CONTROL|ECU)/, "TECU"],
  [/DRIVER\s+DOOR/, "DDM"],
  [/CLIMATE\s+CONTROL/, "CCM"],
  [/VEHICLE\s+MASTER/, "VMCU"],
]

// OCR misreads / truncations of the printed ECU acronym (one token). Keys are
// already stripped (uppercase A-Z0-9 only, see `alnum`).
const V4_ECU_TOKEN_ALIASES: Readonly<Record<string, V4EcuAcronym>> = {
  // CCIOM (centre chassis I/O module); "CIM" is the usual truncation.
  CCIODM: "CCIOM",
  CCIOIM: "CCIOM",
  CC1OM: "CCIOM",
  CCI0M: "CCIOM",
  CIM: "CCIOM",
  // CIOM (cab I/O module)
  CIOIM: "CIOM",
  C1OM: "CIOM",
  CI0M: "CIOM",
  // FCIOM (front chassis I/O module)
  FCIOIM: "FCIOM",
  FCI0M: "FCIOM",
  FC1OM: "FCIOM",
  // RCIOM (rear chassis I/O module)
  RCIOIM: "RCIOM",
  RCI0M: "RCIOM",
  RC1OM: "RCIOM",
  // HMIIOM (HMI I/O module)
  HMIIOIM: "HMIIOM",
  HM1IOM: "HMIIOM",
  // VMCU
  VMCUI: "VMCU",
}

// Spelled-out names matched as a substring of the stripped label, longest
// first, so "REARCHASSISIOMODULE" can never be read as the generic
// "CHASSISIOMODULE".
const V4_ECU_NAME_ALIASES: ReadonlyArray<readonly [string, V4EcuAcronym]> = (
  [
    ["CENTERCHASSISIOMODULE", "CCIOM"],
    ["CENTRECHASSISIOMODULE", "CCIOM"],
    ["CENTRALCHASSISIOMODULE", "CCIOM"],
    ["FRONTCHASSISIOMODULE", "FCIOM"],
    ["REARCHASSISIOMODULE", "RCIOM"],
    ["CABIOMODULE", "CIOM"],
    ["HMIIOMODULE", "HMIIOM"],
    ["HUMANMACHINEINTERFACEIOMODULE", "HMIIOM"],
    ["VEHICLEMASTERCONTROLUNIT", "VMCU"],
    ["ENGINECONTROLMODULE", "EMS"],
    ["AFTERTREATMENTCONTROLMODULE", "ACM"],
    ["AIRPRODUCTIONMODULATOR", "APM"],
    ["ELECTRONICBRAKESYSTEM", "EBS"],
    ["ANTILOCKBRAKESYSTEM", "ABS"],
    ["DRIVERDOORMODULE", "DDM"],
    ["PASSENGERDOORMODULE", "PDM"],
    ["TRANSMISSIONELECTRONICCONTROLUNIT", "TECU"],
    ["GEARBOXCONTROLUNIT", "TECU"],
    ["CLIMATECONTROLMODULE", "CCM"],
    ["INSTRUMENTCLUSTER", "IC"],
  ] as const
)
  .slice()
  .sort((a, b) => b[0].length - a[0].length)

// Only the whole label ("Chassis I/O Module") counts: any longer name that
// merely contains it (Rear / Front / Cab ...) names a different unit.
const V4_ECU_EXACT_NAME_ALIASES: Readonly<Record<string, V4EcuAcronym>> = {
  CHASSISIOMODULE: "CCIOM",
}

// "Cab Chassis I/O Module" is only a CCIOM when the DTC itself belongs to the
// CCIOM; on its own it is too vague to trust.
const V4_ECU_CONDITIONAL_NAME_ALIASES: Readonly<
  Record<string, { hint: V4EcuAcronym; acronym: V4EcuAcronym }>
> = {
  CABCHASSISIOMODULE: { hint: "CCIOM", acronym: "CCIOM" },
}

// High-confidence FH V4 DTC -> control unit ownership. Every code listed here
// is raised by exactly one module, so when OCR garbles (or drops) the ECU
// label the DTC decides which module it is.
const V4_DTC_OWNERS_BY_ECU: Readonly<Record<V4EcuAcronym, readonly string[]>> = {
  CCIOM: ["C103715", "C10F054", "U114187"],
  APM: ["C101024", "C101068", "U002886"],
  RCIOM: ["C114864", "C10D616"],
  VMCU: ["U300A62"],
  EBS: ["C006154"],
  DDM: ["B150254"],
  ACM: ["P107B13", "P107C13", "P107D13", "P107E13"],
  EMS: ["P255613", "P255800", "P101713", "P16F600", "P10F800", "P111D00"],
  FCIOM: ["C108F15", "C109015"],
  CIOM: ["B151095", "U114E87"],
  HMIIOM: ["U10A500"],
  ABS: ["C100201"],
  CCM: [],
  TECU: [],
  PDM: [],
  IC: [],
}

export const V4_DTC_OWNERS: ReadonlyMap<string, V4EcuAcronym> = new Map(
  (Object.entries(V4_DTC_OWNERS_BY_ECU) as [V4EcuAcronym, readonly string[]][])
    .flatMap(([ecu, codes]) => codes.map((code): [string, V4EcuAcronym] => [code, ecu]))
)

// MID -> the keyword the ECU's printed name must contain on an FH V3 truck
// (see the MID identification map used by the diagnostic prompt). A printed
// name that contradicts its MID is an OCR red flag.
const V3_MID_NAME_KEYWORDS: Readonly<Record<number, RegExp>> = {
  128: /ENGINE/,
  130: /GEARBOX|TRANSMISSION/,
  136: /BRAKE|EBS|ABS/,
  140: /INSTRUMENT|DISPLAY|CLUSTER/,
  144: /VEHICLE|VECU/,
  146: /CLIMATE|ECC/,
  185: /AIR\s*PRODUCTION|APM/,
  216: /LIGHT|LCM/,
  222: /RETARDER|RECU/,
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

// Uppercases and strips whitespace, colons, periods (and the hyphens /
// underscores OCR sometimes inserts) so "PID: 175" and "pid175" compare equal.
function strip(value: string): string {
  return value.toUpperCase().replace(/[\s:.\-_]+/g, "")
}

// "007" -> "7"; refuses absurdly long numbers (OCR noise).
function parseNumber(digits: string): number | null {
  if (digits.length === 0 || digits.length > 5) return null
  return Number.parseInt(digits, 10)
}

// ASCII alphanumerics only, for fallback keys.
const alnum = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "")

/**
 * Normalises a V4 control-unit label to a standard uppercase acronym, e.g.
 * `"Engine Control Module (EMS)"` -> `"EMS"`, and repairs the usual OCR
 * misreads (`"CCIODM"`, `"CIM"`, ...) through the alias tables. Returns `null`
 * when the ECU is not one of the known V4 modules.
 *
 * `dtcOwnerHint` is the module that owns the row's DTC (if the DTC is in the
 * ownership map); it only unlocks names that are too vague on their own
 * (`"Cab Chassis I/O Module"` with a CCIOM DTC).
 */
export function normalizeEcuAcronym(
  label: string,
  dtcOwnerHint: V4EcuAcronym | null = null
): V4EcuAcronym | null {
  const upper = label.toUpperCase()

  // A parenthesised acronym is what PTT prints, so it wins.
  for (const match of upper.matchAll(/\(\s*([A-Z0-9]+)\s*\)/g)) {
    if (V4_ECU_SET.has(match[1])) return match[1] as V4EcuAcronym
  }
  for (const match of upper.matchAll(/\(\s*([A-Z0-9]+)\s*\)/g)) {
    const alias = V4_ECU_TOKEN_ALIASES[match[1]]
    if (alias) return alias
  }
  const tokens = upper.match(/[A-Z0-9]+/g) ?? []
  for (const token of tokens) {
    if (V4_ECU_SET.has(token)) return token as V4EcuAcronym
  }
  for (const token of tokens) {
    const alias = V4_ECU_TOKEN_ALIASES[token]
    if (alias) return alias
  }
  for (const [pattern, acronym] of V4_ECU_NAME_PATTERNS) {
    if (pattern.test(upper)) return acronym
  }

  const stripped = alnum(label)
  // Whole label with punctuation/spacing removed ("C-C-I-O-D-M", "CC IOM").
  if (V4_ECU_SET.has(stripped)) return stripped as V4EcuAcronym
  const wholeAlias = V4_ECU_TOKEN_ALIASES[stripped]
  if (wholeAlias) return wholeAlias
  const exact = V4_ECU_EXACT_NAME_ALIASES[stripped]
  if (exact) return exact
  const conditional = V4_ECU_CONDITIONAL_NAME_ALIASES[stripped]
  if (conditional && conditional.hint === dtcOwnerHint) {
    return conditional.acronym
  }
  for (const [name, acronym] of V4_ECU_NAME_ALIASES) {
    if (stripped.includes(name)) return acronym
  }
  return null
}

// ---------------------------------------------------------------------------
// DTC-to-ECU ownership rescue
// ---------------------------------------------------------------------------

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j]
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      diagonal = above
    }
  }
  return previous[b.length]
}

const ECU_WORD_HINT =
  /\b(MODULE|CONTROL|UNIT|ECU|CHASSIS|CAB|I\/O|IO|MASTER|CLUSTER|BRAKE|DOOR|GEARBOX|TRANSMISSION|ENGINE|AFTERTREATMENT|CLIMATE|INTERFACE)\b/

const FUZZY_TARGETS: readonly string[] = [
  ...V4_ECU_ACRONYMS,
  ...Object.keys(V4_ECU_TOKEN_ALIASES),
].filter((target) => target.length >= 3)

/**
 * True when an ECU label that matched no module still looks like a (garbled)
 * ECU name - blank / "unit not readable", ECU vocabulary, or a token one or
 * two typos away from a known acronym. Pure noise ("Mystery Box (XYZ)") is not
 * ECU-like, so a DTC is never re-attributed on the strength of garbage.
 */
function looksLikeEcuLabel(label: string): boolean {
  const stripped = alnum(label)
  if (stripped.replace(/UNIT|NOTREADABLE|UNREADABLE|UNKNOWN|NA/g, "") === "") {
    return true
  }
  if (ECU_WORD_HINT.test(label.toUpperCase())) return true
  return (label.toUpperCase().match(/[A-Z0-9]+/g) ?? []).some(
    (token) =>
      token.length >= 3 &&
      FUZZY_TARGETS.some(
        (target) =>
          editDistance(token, target) <= (target.length <= 4 ? 1 : 2)
      )
  )
}

export type V4EcuResolution = {
  ecu: V4EcuAcronym | null
  /** The printed label that was overridden by the DTC owner, when rescued. */
  rescuedFrom: string | null
}

/**
 * Resolves the control unit of an FH V4 row. The label is normalised first
 * (alias tables); then, for an unambiguous DTC owned by exactly one module,
 * an unknown or contradicting label is replaced by the authoritative module.
 * `allowRescue` is `false` for trucks registered as FH V3.
 */
export function resolveV4Ecu(
  label: string,
  dtc: string,
  allowRescue = true
): V4EcuResolution {
  const owner = allowRescue ? (V4_DTC_OWNERS.get(dtc) ?? null) : null
  const named = normalizeEcuAcronym(label, owner)
  if (!owner || named === owner) return { ecu: named, rescuedFrom: null }
  if (named === null && !looksLikeEcuLabel(label)) {
    return { ecu: null, rescuedFrom: null }
  }
  return { ecu: owner, rescuedFrom: label.trim() || "(blank)" }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type KeyValidationStatus = "VALID" | "SUSPICIOUS" | "MALFORMED"

export type KeyValidation = {
  status: KeyValidationStatus
  generation: PttKnownGeneration | null
  /** Human-readable reasons; empty when `status === "VALID"`. */
  issues: string[]
}

/**
 * Validates an already-built canonical key.
 *  - `MALFORMED`: does not match the strict V3 / V4 format.
 *  - `SUSPICIOUS`: well-formed but contains values real PTT never prints
 *    (e.g. FMI above 31, MID above 255, an unknown V4 ECU acronym), which
 *    almost always means the OCR misread a digit.
 * Anything not `VALID` must be surfaced for review instead of being diffed
 * silently.
 */
export function validateCanonicalKey(key: string): KeyValidation {
  if (V3_KEY_REGEX.test(key)) {
    const issues: string[] = []
    const match = /^MID(\d+)\|(PID|PPID|SID|PSID)(\d+)\|FMI(\d+)$/.exec(key)
    const mid = Number(match?.[1])
    const type = match?.[2]
    const code = Number(match?.[3])
    const fmi = Number(match?.[4])

    if (mid < 1 || mid > 255) {
      issues.push(`MID ${mid} is outside the valid range 1-255`)
    }
    if (fmi > 31) issues.push(`FMI ${fmi} is outside the valid range 0-31`)
    if (type === "PID" && code > 511) {
      issues.push(`PID ${code} is above the J1587 maximum of 511`)
    }
    if (type === "SID" && code > 254) {
      issues.push(`SID ${code} is above the J1587 maximum of 254`)
    }
    if ((type === "PPID" || type === "PSID") && code > 999) {
      issues.push(`${type} ${code} is implausibly large`)
    }
    return {
      status: issues.length ? "SUSPICIOUS" : "VALID",
      generation: "FH_V3",
      issues,
    }
  }

  if (V4_KEY_REGEX.test(key)) {
    const ecu = key.split("|")[0]
    return V4_ECU_SET.has(ecu)
      ? { status: "VALID", generation: "FH_V4", issues: [] }
      : {
          status: "SUSPICIOUS",
          generation: "FH_V4",
          issues: [`"${ecu}" is not a known FH V4 control unit acronym`],
        }
  }

  return {
    status: "MALFORMED",
    generation: null,
    issues: [
      "Does not match the FH V3 (MID#|PID#|FMI#) or FH V4 (ECU|DTC) key format",
    ],
  }
}

// ---------------------------------------------------------------------------
// Key construction
// ---------------------------------------------------------------------------

export type CanonicalKeyInput = {
  /** Control unit as printed, e.g. `Engine ECU (MID 128)`. */
  controlUnit: string
  /** Fault code as printed, e.g. `PID 175 FMI 5` or `P111D00`. */
  faultCode: string
  /** Truck generation if known; used only to break ties between formats. */
  generation?: PttKnownGeneration | "UNKNOWN"
}

export type CanonicalKeyResult =
  | {
      ok: true
      key: string
      generation: PttKnownGeneration
      /** OCR-suspicious findings; the key is usable but should be reviewed. */
      warnings: string[]
      /**
       * Non-blocking hint: the printed ECU label was unknown/contradictory and
       * the module was taken from the DTC's known owner instead.
       */
      ecuRescuedFrom?: string
    }
  | {
      ok: false
      reason: string
      /**
       * Stable, deterministic stand-in (`UNVERIFIED|ECU|CODE`) so the row can
       * still be stored; it never matches a real canonical key.
       */
      fallbackKey: string
    }

function failure(input: CanonicalKeyInput, reason: string): CanonicalKeyResult {
  return {
    ok: false,
    reason,
    fallbackKey: `UNVERIFIED|${alnum(input.controlUnit).slice(0, 40)}|${alnum(input.faultCode).slice(0, 40)}`,
  }
}

const V3_CODE_REGEX = /(PPID|PSID|PID|SID)(\d+)/g
const V4_CODE_REGEX = /^[PCBU][0-9A-F]{6}$/

function buildV3(input: CanonicalKeyInput): CanonicalKeyResult {
  const unit = strip(input.controlUnit)
  const code = strip(input.faultCode)

  const midFromUnit = /MID0*(\d+)/.exec(unit)?.[1]
  const midFromCode = /MID0*(\d+)/.exec(code)?.[1]
  if (midFromUnit && midFromCode && Number(midFromUnit) !== Number(midFromCode)) {
    return failure(
      input,
      `MID in the control unit (${midFromUnit}) conflicts with the MID in the code (${midFromCode})`
    )
  }
  const midDigits = midFromUnit ?? midFromCode
  if (!midDigits) {
    return failure(input, "No MID number could be read for the control unit")
  }

  const typeMatches = [...code.matchAll(V3_CODE_REGEX)]
  if (typeMatches.length !== 1) {
    return failure(
      input,
      typeMatches.length === 0
        ? "No PID / PPID / SID / PSID code could be read"
        : "More than one PID / PPID / SID / PSID code was read from one row"
    )
  }
  const [, codeType, codeDigits] = typeMatches[0]

  const fmiDigits = /FMI(\d+)/.exec(code)?.[1]
  if (!fmiDigits) return failure(input, "No FMI could be read")

  const mid = parseNumber(midDigits)
  const num = parseNumber(codeDigits)
  const fmi = parseNumber(fmiDigits)
  if (mid === null || num === null || fmi === null) {
    return failure(input, "A MID / code / FMI number is too long to be genuine")
  }

  const key = `MID${mid}|${codeType}${num}|FMI${fmi}`
  if (!V3_KEY_REGEX.test(key)) {
    return failure(input, "Built key does not match the FH V3 format")
  }

  const warnings = validateCanonicalKey(key).issues
  // Only judge a printed name that clearly names a *different* known ECU
  // (e.g. "Vehicle ECU (MID 128)"); unrecognised names are left alone.
  const keyword = V3_MID_NAME_KEYWORDS[mid]
  const named = input.controlUnit.toUpperCase()
  if (keyword && !keyword.test(named)) {
    const namesOtherEcu = Object.entries(V3_MID_NAME_KEYWORDS).some(
      ([otherMid, pattern]) => Number(otherMid) !== mid && pattern.test(named)
    )
    if (namesOtherEcu) {
      warnings.push(
        `Control unit name "${input.controlUnit.trim()}" does not match MID ${mid}`
      )
    }
  }

  return { ok: true, key, generation: "FH_V3", warnings }
}

function buildV4(input: CanonicalKeyInput): CanonicalKeyResult {
  const dtc = strip(input.faultCode)
  // DTC-owner rescue applies to FH V4 data only (never a V3-registered truck).
  const { ecu, rescuedFrom } = resolveV4Ecu(
    input.controlUnit,
    dtc,
    input.generation !== "FH_V3"
  )
  if (!ecu) {
    return failure(
      input,
      `Control unit "${input.controlUnit.trim()}" is not a known FH V4 module`
    )
  }

  if (!V4_CODE_REGEX.test(dtc)) {
    const nonHex = /[^PCBU0-9A-F]/.test(dtc.slice(1))
    return failure(
      input,
      nonHex
        ? `DTC "${input.faultCode.trim()}" contains non-hex characters (possible O/0 or I/1 misread)`
        : `DTC "${input.faultCode.trim()}" is not a 7-character P/C/B/U code`
    )
  }

  const key = `${ecu}|${dtc}`
  if (!V4_KEY_REGEX.test(key)) {
    return failure(input, "Built key does not match the FH V4 format")
  }
  return {
    ok: true,
    key,
    generation: "FH_V4",
    warnings: [],
    ...(rescuedFrom ? { ecuRescuedFrom: rescuedFrom } : {}),
  }
}

/**
 * Builds the canonical key for one extracted DTC. The format (V3 vs V4) is
 * taken from the shape of the code; `generation` only breaks ties. Returns a
 * failure with a deterministic fallback key when the row cannot be
 * normalised, so it is surfaced for review rather than silently mismatched.
 */
export function buildCanonicalKey(input: CanonicalKeyInput): CanonicalKeyResult {
  const code = strip(input.faultCode)
  const looksV4 = V4_CODE_REGEX.test(code)
  const looksV3 = /FMI\d+/.test(code)

  let format: PttKnownGeneration
  if (looksV3 && !looksV4) format = "FH_V3"
  else if (looksV4 && !looksV3) format = "FH_V4"
  else if (input.generation === "FH_V3" || input.generation === "FH_V4") {
    format = input.generation
  } else if (/MID\d+/.test(strip(input.controlUnit))) {
    format = "FH_V3" // The ECU is printed with a MID, so a V3 code was expected.
  } else if (normalizeEcuAcronym(input.controlUnit)) {
    format = "FH_V4"
  } else {
    return failure(input, "Fault code is neither an FH V3 nor an FH V4 format")
  }

  const result = format === "FH_V3" ? buildV3(input) : buildV4(input)
  if (
    result.ok &&
    (input.generation === "FH_V3" || input.generation === "FH_V4") &&
    input.generation !== result.generation
  ) {
    result.warnings.push(
      `Code format is ${result.generation} but the truck is registered as ${input.generation}`
    )
  }
  return result
}
