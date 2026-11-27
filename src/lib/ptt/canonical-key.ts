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
  // (becomes CIOM instead for "Cab I/O Module (CIM)" / a CIOM DTC; see
  // `normalizeEcuAcronym`.)
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

  // "CIM" is the usual truncation of CCIOM, but it is the Cab I/O Module's
  // (CIOM) acronym when the label says "Cab I/O Module" (not "Cab Chassis ...")
  // or the DTC belongs to the CIOM.
  const cimIsCiom =
    dtcOwnerHint === "CIOM" || /\bCAB\s+I\s*\/?\s*O\b/.test(upper)
  const aliasOf = (token: string): V4EcuAcronym | undefined =>
    token === "CIM" && cimIsCiom ? "CIOM" : V4_ECU_TOKEN_ALIASES[token]

  // A parenthesised acronym is what PTT prints, so it wins.
  for (const match of upper.matchAll(/\(\s*([A-Z0-9]+)\s*\)/g)) {
    if (V4_ECU_SET.has(match[1])) return match[1] as V4EcuAcronym
  }
  for (const match of upper.matchAll(/\(\s*([A-Z0-9]+)\s*\)/g)) {
    const alias = aliasOf(match[1])
    if (alias) return alias
  }
  const tokens = upper.match(/[A-Z0-9]+/g) ?? []
  for (const token of tokens) {
    if (V4_ECU_SET.has(token)) return token as V4EcuAcronym
  }
  for (const token of tokens) {
    const alias = aliasOf(token)
    if (alias) return alias
  }
  for (const [pattern, acronym] of V4_ECU_NAME_PATTERNS) {
    if (pattern.test(upper)) return acronym
  }

  const stripped = alnum(label)
  // Whole label with punctuation/spacing removed ("C-C-I-O-D-M", "CC IOM").
  if (V4_ECU_SET.has(stripped)) return stripped as V4EcuAcronym
  const wholeAlias = aliasOf(stripped)
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
  /**
   * Truck generation if known; breaks ties between formats and gates the
   * generation-specific OCR rescues (`FH_V3` / `FH_V4` only).
   */
  generation?: PttKnownGeneration | "UNKNOWN"
  /**
   * The fault description as printed. Only used by the description-guarded OCR
   * rescues (a rescue never fires on a code alone).
   */
  description?: string
  /** Facts about the rest of the same scan (see `buildKeyScanContext`). */
  scanContext?: CanonicalKeyScanContext
}

/**
 * What one scan tells us about its other rows. Used by the cross-row rescue of
 * a cropped `Engine ECU` label on `PID 110 FMI 5`, which is really the
 * Retarder ECU when the same scan also holds other Retarder faults.
 */
export type CanonicalKeyScanContext = {
  hasRetarderFault: boolean
}

export const EMPTY_SCAN_CONTEXT: CanonicalKeyScanContext = {
  hasRetarderFault: false,
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

// ---------------------------------------------------------------------------
// Fault-code sanitiser
//
// Pass 1 sometimes returns the whole PTT DTC column in the code field, e.g.
// "C103715: Chassis Lubrication Motor, Circuit Short To Battery or Open" or
// "PSID 214: Data link, MID249, FMI 9: Abnormal update rate". Only the bare
// code token (plus an FMI recovered from the trailing text) may reach the key.
// ---------------------------------------------------------------------------

/** A V3 code token as printed (`PSID 214`, `pid. 175`, `PPID3`). */
const V3_TOKEN_PRINTED = /\b(?:PPID|PSID|PID|SID)\s*\.?\s*\d+/i
const V4_TOKEN_PRINTED = /\b[PCBU][0-9A-F]{6}\b/gi
const FMI_PRINTED = /\bFMI\s*[:.]?\s*(\d+)/i

/** Bare, alphanumeric edges: drops trailing / leading punctuation noise. */
const trimCodeNoise = (value: string): string =>
  value.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")

/** A single V4 hex DTC embedded in `text` (with at least one digit), or null. */
function embeddedV4Dtc(text: string): string | null {
  const found = [...text.matchAll(V4_TOKEN_PRINTED)]
    .map((match) => match[0].toUpperCase())
    .filter((token) => /\d/.test(token))
  return found.length === 1 ? found[0] : null
}

/**
 * Reduces a printed fault code to its bare token: everything after the first
 * `:` (the description / "MIDnnn" / "FMI n" text) is removed when the
 * left-hand side is itself a complete code, trailing punctuation is trimmed,
 * and a V4 DTC buried in a concatenated ECU label is extracted. On FH V3 an
 * FMI that is not on the left-hand side is recovered from the dropped right
 * half (or the description) so `PSID 214: ..., FMI 9: ...` -> `PSID 214 FMI 9`.
 * Idempotent; a code with no recognisable token is returned only trimmed.
 */
export function sanitizeFaultCode(
  faultCode: string,
  options: { description?: string; generation?: PttKnownGeneration | "UNKNOWN" } = {}
): string {
  const original = faultCode.trim()
  const colon = original.indexOf(":")
  let left = original
  let right = ""
  if (colon >= 0) {
    const head = original.slice(0, colon)
    const headCompact = alnum(head)
    // "PID: 175 FMI 5" keeps its colon (no number on the left of it).
    if (V3_TOKEN_PRINTED.test(head) || V4_CODE_REGEX.test(headCompact)) {
      left = head
      right = original.slice(colon + 1)
    }
  }
  left = trimCodeNoise(left)

  // ECU label concatenated in front of / behind a V4 DTC.
  if (
    options.generation !== "FH_V3" &&
    !V4_CODE_REGEX.test(alnum(left)) &&
    !V3_TOKEN_PRINTED.test(left)
  ) {
    const embedded = embeddedV4Dtc(left)
    if (embedded) left = embedded
  }

  const isV3 = V3_TOKEN_PRINTED.test(left) && !FMI_PRINTED.test(left)
  if (isV3 && options.generation !== "FH_V4") {
    const fmi =
      FMI_PRINTED.exec(right)?.[1] ??
      (options.generation === "FH_V3"
        ? FMI_PRINTED.exec(options.description ?? "")?.[1]
        : undefined)
    if (fmi) left = `${left} FMI ${fmi}`
  }
  return left
}

// ---------------------------------------------------------------------------
// FH V3 / FH V4 OCR rescues
//
// Surgical, DESCRIPTION-GUARDED repairs for OCR glitches seen on real fleet
// scans (hallucinated / cropped ECU labels, dropped or inserted digits). A
// rescue only fires for the exact generation it was written for, only on a
// code + description combination that is known to be wrong, and never on a
// row that is already correct. Pure and deterministic.
// ---------------------------------------------------------------------------

type V3CodeType = "PID" | "PPID" | "SID" | "PSID"
/** `RID` is never a valid type; it is only an OCR misread of `PID` (rescue B.5). */
type V3ParsedType = V3CodeType | "RID"

type V3ParsedCode = { type: V3ParsedType; num: number; fmi: number }

/** Lenient parse of a stripped V3 fault code (`PSID10FMI2`), or null. */
function parseV3Code(code: string): V3ParsedCode | null {
  const matches = [...code.matchAll(V3_CODE_REGEX)]
  let type: V3ParsedType
  let digits: string
  if (matches.length === 1) {
    type = matches[0][1] as V3CodeType
    digits = matches[0][2]
  } else if (matches.length === 0) {
    const rid = /RID(\d+)/.exec(code)
    if (!rid) return null
    type = "RID"
    digits = rid[1]
  } else {
    return null
  }
  const fmiDigits = /FMI(\d+)/.exec(code)?.[1]
  if (!fmiDigits) return null
  const num = parseNumber(digits)
  const fmi = parseNumber(fmiDigits)
  return num === null || fmi === null ? null : { type, num, fmi }
}

// Lamp ECU names the vision model has been seen inventing from the fault
// description (see the Pass 1 prompt); compared on the alphanumerics only.
const HALLUCINATED_LAMP_ECUS: ReadonlySet<string> = new Set([
  "BRAKELAMPECU",
  "FOGLAMPECU",
  "CAMPAIGNLIGHTSECU",
  "CAMPAIGNLIGHTECU",
  "REVERSELIGHTSECU",
  "REVERSELIGHTECU",
  "UNKNOWNECU",
  "LIGHTECU",
])
const HALLUCINATED_VECU_ECUS: ReadonlySet<string> = new Set([
  "REGENERATIONCONTROLECU",
  "COMPRESSORCONTROLECU",
  "REARLOADSENSORECU",
])

/** Empty / "unit not readable" label: nothing printed that could be verified. */
function isBlankEcuLabel(label: string): boolean {
  return alnum(label).replace(/UNIT|NOTREADABLE|UNREADABLE|UNKNOWN|NA/g, "") === ""
}

const LIGHTING_PSIDS: ReadonlySet<number> = new Set([
  3, 5, 8, 10, 11, 15, 16, 19, 20, 23, 26, 42, 67, 68, 82,
])
const LIGHTING_DESCRIPTION =
  /brake\s*lamp|fog\s*lamp|campaign\s*lights?|reverse\s*lights?|turn\s*signal|high\s*beam|parking\s*light|wiping\s*relay|dimmer|background\s*lighting/
// PSID 68 is often printed with no usable text ("null") or as a circuit fault.
const PSID68_DESCRIPTION = /^null$|circuit\s*open|open\s*circuit/

// A description that is only the standard FMI wording (or empty / "null"):
// it carries no component name.
const FMI_ONLY_DESCRIPTION =
  /^(?:null|(?:data\s+(?:valid|erratic|drifted)|voltage\s+(?:above|below)|current\s+(?:above|below)|abnormal\s|mechanical\s+system|bad\s+intelligent|root\s+cause|special\s+instructions|condition\s+exists|received\s+network|out\s+of\s+calibration|above\s+normal|below\s+normal|faulty\s+device|circuit\s+open|open\s+circuit|short\s+to)\b.*)$/

function hasNoComponentText(description: string): boolean {
  const text = description.trim()
  return text === "" || FMI_ONLY_DESCRIPTION.test(text)
}

const VECU_DESCRIPTIONS: Readonly<Record<number, RegExp>> = {
  23: /regeneration\s*control/,
  24: /compressor\s*control/,
  39: /rear\s*load\s*sensor/,
}

type V3RescueInput = {
  /** MID read from the label / code, or null when none could be read. */
  mid: number | null
  controlUnit: string
  code: V3ParsedCode
  description: string
  scanContext: CanonicalKeyScanContext
}

type V3Rescue = {
  mid: number
  type: V3CodeType
  num: number
  fmi: number
}

/** The ECU a MID-less (blank / cropped / hallucinated) label really is, or null. */
function resolveMissingMid(input: V3RescueInput): number | null {
  const { controlUnit, code, description, scanContext } = input
  const label = alnum(controlUnit)
  const blank = isBlankEcuLabel(controlUnit)
  // Legacy scans stored only the FMI text in the description and the component
  // name in the (hallucinated) ECU label, so the component guard also reads
  // `${ecuLabel} ${description}` - but only when the description names no
  // component of its own (a contradicting description must still block).
  const componentText = hasNoComponentText(description)
    ? `${controlUnit.toLowerCase()} ${description}`
    : description

  // A.3 Retarder ECU printed without "(MID 222)".
  if (/RETARDERECU/.test(label)) return 222

  if (code.type === "PSID") {
    // A.1 Lighting / LCM.
    if (
      (blank || HALLUCINATED_LAMP_ECUS.has(label)) &&
      LIGHTING_PSIDS.has(code.num) &&
      (LIGHTING_DESCRIPTION.test(componentText) ||
        (code.num === 68 && PSID68_DESCRIPTION.test(description)))
    ) {
      return 216
    }
    // A.2 Vehicle ECU.
    const vecuDescription = VECU_DESCRIPTIONS[code.num]
    if (
      (blank || HALLUCINATED_VECU_ECUS.has(label)) &&
      vecuDescription?.test(componentText)
    ) {
      return 144
    }
  }

  // A.5 Cross-row context: a bare "Engine ECU" (its "(MID 128)" cropped off) on
  // PID 110 FMI 5 is the Retarder when the same scan holds other Retarder faults.
  if (
    label === "ENGINEECU" &&
    code.type === "PID" &&
    code.num === 110 &&
    code.fmi === 5 &&
    scanContext.hasRetarderFault
  ) {
    return 222
  }
  return null
}

/**
 * Applies every FH V3 rescue to one row. Returns null when nothing applies
 * (the row is then built exactly as printed).
 */
function rescueV3(input: V3RescueInput): V3Rescue | null {
  const { description, code } = input
  let mid = input.mid
  let { type, num } = code
  const { fmi } = code
  let changed = false

  if (mid === null) {
    const resolved = resolveMissingMid(input)
    if (resolved !== null) {
      mid = resolved
      changed = true
    }
  }

  // A.4 "MID 179" reporting itself: PSID 236 on MID 179 is really raised by the
  // instrument cluster (MID 140) about the missing MID 179 gateway.
  if (
    mid === 179 &&
    type === "PSID" &&
    num === 236 &&
    (fmi === 12 || /data\s*link,?\s*mid\s*179|faulty\s*device\s*or\s*component/.test(description))
  ) {
    mid = 140
    changed = true
  }

  // B. Code / prefix / ECU drift.
  const retype = (nextType: V3CodeType, nextNum: number) => {
    type = nextType
    num = nextNum
    changed = true
  }
  const move = (nextMid: number, nextType: V3CodeType, nextNum: number) => {
    mid = nextMid
    retype(nextType, nextNum)
  }

  if (mid === 144 && type === "PID" && num === 3 && /starter\s*output/.test(description)) {
    retype("PPID", 3)
  } else if (
    mid === 144 &&
    type === "PSID" &&
    (num === 223 || num === 232) &&
    /regeneration\s*control/.test(description)
  ) {
    retype("PSID", 23)
  } else if (
    mid === 144 &&
    type === "PSID" &&
    num === 230 &&
    /rear\s*load\s*sensor/.test(description)
  ) {
    retype("PSID", 39)
  } else if (
    mid === 130 &&
    type === "PSID" &&
    num === 37 &&
    /transmission\s*tank\s*air\s*pressure/.test(description)
  ) {
    retype("PID", 37)
  } else if (
    mid === 140 &&
    (type === "RID" || type === "PID") &&
    num === 116 &&
    /brake\s*secondary\s*pressure/.test(description)
  ) {
    retype("PID", 118)
  } else if (
    (mid === 140 || mid === 144 || mid === null) &&
    type === "PSID" &&
    num === 10 &&
    /\bcd\b/.test(description)
  ) {
    move(206, "PSID", 10)
  } else if (mid === 206 && type === "PSID") {
    const dropped: Readonly<Record<number, readonly [RegExp, number]>> = {
      1: [/audio\s*microphone/, 11],
      2: [/audio\s*output\s*left\s*front/, 12],
      4: [/audio\s*output\s*left\s*rear/, 14],
      5: [/audio\s*output\s*right\s*rear/, 15],
    }
    const entry = dropped[num]
    if (entry && entry[0].test(description)) retype("PSID", entry[1])
  } else if (
    mid === 130 &&
    (type === "PSID" || type === "PID") &&
    num === 171 &&
    fmi === 5 &&
    /ambient\s*air\s*temperature/.test(description)
  ) {
    move(140, "PID", 171)
  } else if (
    mid === 144 &&
    type === "SID" &&
    num === 11 &&
    /magnetic\s*clutch/.test(description)
  ) {
    move(146, "SID", 11)
  } else if (
    // Cropped label column: the Vehicle ECU (MID 144) read as the LCM (MID 216).
    mid === 216 &&
    type === "PID" &&
    num === 84 &&
    /road\s*speed/.test(description)
  ) {
    move(144, "PID", 84)
  } else if (
    // Genuine MID216 PSID 23 is "Parking light left rear" and stays put.
    mid === 216 &&
    type === "PSID" &&
    num === 23 &&
    /regeneration\s*control/.test(description)
  ) {
    move(144, "PSID", 23)
  } else if (
    mid === 216 &&
    type === "PSID" &&
    num === 39 &&
    /rear\s*load\s*sensor/.test(description)
  ) {
    move(144, "PSID", 39)
  } else if (
    // Code / ECU OCR slips.
    mid === 140 &&
    type === "PID" &&
    num === 177 &&
    /ambient\s*air\s*temperature/.test(description)
  ) {
    retype("PID", 171)
  } else if (
    mid === 128 &&
    type === "SID" &&
    num === 16 &&
    /water\s*in\s*fuel/.test(description)
  ) {
    retype("SID", 18)
  } else if (
    mid === 130 &&
    type === "PSID" &&
    num === 46 &&
    /steering\s*wheel\s*buttons/.test(description)
  ) {
    move(140, "PSID", 46)
  } else if (
    // Genuine MID216 PSID 15 is "Turn signal lamp left rear" and stays put.
    mid === 216 &&
    type === "PSID" &&
    num === 15 &&
    /intermittent\s*wiping\s*relay/.test(description)
  ) {
    retype("PSID", 19)
  } else if (
    mid === 223 &&
    type === "PSID" &&
    num === 20 &&
    /pto/.test(description)
  ) {
    move(130, "PSID", 20)
  }

  // "RID" is only valid as an input to the rescues above.
  if (!changed || mid === null || type === "RID") return null
  return { mid, type, num, fmi }
}

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

  // FH V3 OCR rescues (description-guarded); FH V3 trucks only.
  if (input.generation === "FH_V3") {
    const parsed = parseV3Code(code)
    const printedMid = midDigits ? parseNumber(midDigits) : null
    if (parsed && (!midDigits || printedMid !== null)) {
      const rescue = rescueV3({
        mid: printedMid,
        controlUnit: input.controlUnit,
        code: parsed,
        description: (input.description ?? "").toLowerCase().trim(),
        scanContext: input.scanContext ?? EMPTY_SCAN_CONTEXT,
      })
      if (rescue) {
        const key = `MID${rescue.mid}|${rescue.type}${rescue.num}|FMI${rescue.fmi}`
        if (V3_KEY_REGEX.test(key)) {
          return {
            ok: true,
            key,
            generation: "FH_V3",
            warnings: validateCanonicalKey(key).issues,
            ...(printedMid !== rescue.mid
              ? { ecuRescuedFrom: input.controlUnit.trim() || "(blank)" }
              : {}),
          }
        }
      }
    }
  }

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

/**
 * FH V4 single-character hex OCR drift, repaired only when the row's own
 * description confirms which DTC it is. `description` is null for a truck that
 * is not registered as FH V4 (no rescue).
 */
function rescueV4Dtc(
  ecu: V4EcuAcronym,
  dtc: string,
  description: string | null
): string {
  if (description === null) return dtc
  const text = description.toLowerCase()
  if (ecu === "CCIOM" && dtc === "U114B87" && /lin\s*11/.test(text)) {
    return "U114187"
  }
  if (
    ecu === "HMIIOM" &&
    dtc === "U115109" &&
    /lane\s*position\s*object/.test(text)
  ) {
    return "U115100"
  }
  if (
    ecu === "APM" &&
    dtc === "U0028B8" &&
    /can\s*communication\s*chassis\s*net/.test(text)
  ) {
    return "U002886"
  }
  if (ecu === "CIOM" && dtc === "U1148E7" && FLEXIBLE_SWITCH_PANEL.test(text)) {
    return "U114E87"
  }
  return dtc
}

const FLEXIBLE_SWITCH_PANEL = /flexible\s*switch\s*panel\s*link/

function buildV4(input: CanonicalKeyInput): CanonicalKeyResult {
  const dtc = strip(input.faultCode)
  // DTC-owner rescue applies to FH V4 data only (never a V3-registered truck).
  const allowRescue = input.generation !== "FH_V3"
  let resolution = resolveV4Ecu(input.controlUnit, dtc, allowRescue)
  // "CIM" + U1148E7 + "Flexible switch panel link" is the Cab I/O Module's
  // U114E87: resolve the label as if the corrected DTC had been printed, and
  // keep that reading only when it really lands on the CIOM.
  if (
    input.generation === "FH_V4" &&
    dtc === "U1148E7" &&
    FLEXIBLE_SWITCH_PANEL.test((input.description ?? "").toLowerCase())
  ) {
    if (normalizeEcuAcronym(input.controlUnit, "CIOM") === "CIOM") {
      resolution = { ecu: "CIOM", rescuedFrom: null }
    }
  }
  const { ecu, rescuedFrom } = resolution
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

  const key = `${ecu}|${rescueV4Dtc(
    ecu,
    dtc,
    input.generation === "FH_V4" ? (input.description ?? "") : null
  )}`
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
export function buildCanonicalKey(rawInput: CanonicalKeyInput): CanonicalKeyResult {
  // Only the bare code token (and its FMI) may reach the key: see
  // `sanitizeFaultCode`. The clean code feeds matching AND the fallback key.
  const input: CanonicalKeyInput = {
    ...rawInput,
    faultCode: sanitizeFaultCode(rawInput.faultCode, {
      description: rawInput.description,
      generation: rawInput.generation,
    }),
  }
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
