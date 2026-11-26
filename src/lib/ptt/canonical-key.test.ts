import { describe, expect, it } from "vitest"

import {
  V3_KEY_REGEX,
  V4_KEY_REGEX,
  buildCanonicalKey,
  normalizeEcuAcronym,
  validateCanonicalKey,
} from "./canonical-key"
import { FLEET_WIDE_EXCEPTION_SEEDS } from "./exception-seed-data"

function ok(controlUnit: string, faultCode: string) {
  const result = buildCanonicalKey({ controlUnit, faultCode })
  if (!result.ok) throw new Error(`expected a key, got: ${result.reason}`)
  return result
}

describe("buildCanonicalKey - FH V3", () => {
  it("builds MID|PID|FMI from the printed ECU and code", () => {
    const result = ok("Engine ECU (MID 128)", "PID 175 FMI 5")
    expect(result.key).toBe("MID128|PID175|FMI5")
    expect(result.generation).toBe("FH_V3")
    expect(result.warnings).toEqual([])
  })

  it.each([
    ["Vehicle ECU (MID 144)", "PPID 312 FMI 7", "MID144|PPID312|FMI7"],
    ["Vehicle ECU (MID 144)", "PSID 23 FMI 4", "MID144|PSID23|FMI4"],
    ["Engine ECU (MID 128)", "SID 18 FMI 5", "MID128|SID18|FMI5"],
    ["Information Display (MID 140)", "PSID 214 FMI 12", "MID140|PSID214|FMI12"],
    ["Radio (MID 206)", "PSID 10 FMI 2", "MID206|PSID10|FMI2"],
  ])("normalises %s / %s", (unit, code, expected) => {
    expect(ok(unit, code).key).toBe(expected)
  })

  it("strips spaces, colons and periods and uppercases", () => {
    expect(ok("engine ecu ( mid: 128 )", "pid. 175 : fmi 5").key).toBe(
      "MID128|PID175|FMI5"
    )
    expect(ok("Engine ECU (MID128)", "PID175FMI5").key).toBe("MID128|PID175|FMI5")
  })

  it("removes leading zeros so the same fault always yields the same key", () => {
    expect(ok("Engine ECU (MID 128)", "PID 084 FMI 09").key).toBe(
      "MID128|PID84|FMI9"
    )
  })

  it("accepts the MID inside the fault code when the unit label has none", () => {
    expect(ok("Engine ECU", "MID 128 PID 175 FMI 5").key).toBe("MID128|PID175|FMI5")
  })

  it("never confuses PSID / PPID with PID / SID", () => {
    expect(ok("Vehicle ECU (MID 144)", "PSID 24 FMI 4").key).toBe("MID144|PSID24|FMI4")
    expect(ok("Vehicle ECU (MID 144)", "PPID 3 FMI 4").key).toBe("MID144|PPID3|FMI4")
  })

  it("every key it builds matches the strict V3 regex", () => {
    expect(V3_KEY_REGEX.test(ok("Engine ECU (MID 128)", "PID 175 FMI 5").key)).toBe(true)
  })

  it.each([
    ["Engine ECU", "PID 175 FMI 5", "MID"],
    ["Engine ECU (MID 128)", "XID 175 FMI 5", "PID"],
    ["Engine ECU (MID 128)", "PID 175", "FMI"],
    ["Engine ECU (MID 128)", "PID 175 SID 4 FMI 5", "More than one"],
    ["Engine ECU (MID 128)", "MID 130 PID 175 FMI 5", "conflicts"],
  ])("rejects %s / %s", (unit, code, reasonPart) => {
    const result = buildCanonicalKey({ controlUnit: unit, faultCode: code })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain(reasonPart)
      expect(result.fallbackKey.startsWith("UNVERIFIED|")).toBe(true)
    }
  })

  it("flags an OCR-suspicious VECU code instead of silently accepting it", () => {
    const result = ok("Vehicle ECU (MID 144)", "PSID 2300 FMI 44")
    expect(result.key).toBe("MID144|PSID2300|FMI44")
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it("flags a control-unit name that contradicts its MID", () => {
    const result = ok("Vehicle ECU (MID 128)", "PID 175 FMI 5")
    expect(result.warnings.join(" ")).toContain("does not match MID 128")
  })

  it("gives a stable fallback key for the same unreadable row", () => {
    const a = buildCanonicalKey({ controlUnit: "Engine ECU", faultCode: "PID 175 FMI 5" })
    const b = buildCanonicalKey({ controlUnit: "ENGINE ECU", faultCode: "pid175fmi5" })
    expect(a.ok || b.ok).toBe(false)
    if (!a.ok && !b.ok) expect(a.fallbackKey).toBe(b.fallbackKey)
  })
})

describe("buildCanonicalKey - FH V4", () => {
  it("builds ECU|DTC from the printed module name and code", () => {
    const result = ok("Engine Control Module (EMS)", "P111D00")
    expect(result.key).toBe("EMS|P111D00")
    expect(result.generation).toBe("FH_V4")
    expect(result.warnings).toEqual([])
  })

  it("strips noise and uppercases the DTC", () => {
    expect(ok("Engine Control Module (EMS)", "p111d-00").key).toBe("EMS|P111D00")
    expect(ok("Cab Central IO Module (CCIOM)", "C10 3715").key).toBe("CCIOM|C103715")
    expect(ok("TECU", "U300054").key).toBe("TECU|U300054")
  })

  it("every key it builds matches the strict V4 regex", () => {
    expect(V4_KEY_REGEX.test(ok("Engine Control Module (EMS)", "P111D00").key)).toBe(true)
  })

  it("does not mistake CIOM for CCIOM (or vice versa)", () => {
    expect(normalizeEcuAcronym("Cab IO Module (CIOM)")).toBe("CIOM")
    expect(normalizeEcuAcronym("Central Chassis IO Module (CCIOM)")).toBe("CCIOM")
  })

  it.each([
    ["Engine Control Module (EMS)", "EMS"],
    ["Aftertreatment Control Module (ACM)", "ACM"],
    ["Air Production Module (APM)", "APM"],
    ["ABS", "ABS"],
    ["EBS", "EBS"],
    ["Front Chassis IO Module (FCIOM)", "FCIOM"],
    ["Rear Chassis IO Module (RCIOM)", "RCIOM"],
    ["Driver Door Module (DDM)", "DDM"],
    ["HMI IO Module (HMIIOM)", "HMIIOM"],
    ["Climate Control Module (CCM)", "CCM"],
    ["Transmission Control Unit (TECU)", "TECU"],
    ["Vehicle Master Control Unit (VMCU)", "VMCU"],
    ["Engine Control Module", "EMS"],
  ])("normalises ECU %s -> %s", (label, acronym) => {
    expect(normalizeEcuAcronym(label)).toBe(acronym)
  })

  it("returns null for an unknown ECU", () => {
    expect(normalizeEcuAcronym("Mystery Box (XYZ)")).toBeNull()
  })

  it.each([
    ["Engine Control Module (EMS)", "P111DOO", "non-hex"],
    ["Engine Control Module (EMS)", "X111D00", "7-character"],
    ["Engine Control Module (EMS)", "P111D0", "7-character"],
    ["Mystery Box (XYZ)", "P111D00", "not a known FH V4 module"],
  ])("rejects %s / %s", (unit, code, reasonPart) => {
    const result = buildCanonicalKey({ controlUnit: unit, faultCode: code })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(reasonPart)
  })
})

describe("buildCanonicalKey - generation hint", () => {
  it("decides by code shape and warns when the truck is registered differently", () => {
    const result = buildCanonicalKey({
      controlUnit: "Engine Control Module (EMS)",
      faultCode: "P111D00",
      generation: "FH_V3",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.generation).toBe("FH_V4")
      expect(result.warnings.join(" ")).toContain("registered as FH_V3")
    }
  })

  it("rejects an unrecognisable code", () => {
    const result = buildCanonicalKey({
      controlUnit: "Engine ECU (MID 128)",
      faultCode: "VCADS stuff",
    })
    expect(result.ok).toBe(false)
  })
})

describe("validateCanonicalKey", () => {
  it("marks well-formed keys VALID", () => {
    expect(validateCanonicalKey("MID128|PID175|FMI5")).toEqual({
      status: "VALID",
      generation: "FH_V3",
      issues: [],
    })
    expect(validateCanonicalKey("EMS|P111D00").status).toBe("VALID")
    expect(validateCanonicalKey("CCIOM|C103715").generation).toBe("FH_V4")
  })

  it.each([
    "mid128|pid175|fmi5",
    "MID128|PID175",
    "MID128|XID175|FMI5",
    "MID128 | PID175 | FMI5",
    "EMS|P111D0",
    "EMS|Z111D00",
    "EMS|P111G00",
    "UNVERIFIED|ENGINEECU|PID175FMI5",
    "",
  ])("marks %j MALFORMED", (key) => {
    expect(validateCanonicalKey(key).status).toBe("MALFORMED")
  })

  it.each([
    ["MID128|PID175|FMI40", "FMI 40"],
    ["MID999|PID175|FMI5", "MID 999"],
    ["MID128|PID900|FMI5", "PID 900"],
    ["MID128|SID300|FMI5", "SID 300"],
    ["MID144|PSID5000|FMI4", "PSID 5000"],
    ["XYZ|P111D00", "XYZ"],
  ])("marks %s SUSPICIOUS", (key, issuePart) => {
    const result = validateCanonicalKey(key)
    expect(result.status).toBe("SUSPICIOUS")
    expect(result.issues.join(" ")).toContain(issuePart)
  })
})

describe("approved-exception seed keys", () => {
  it("are all valid canonical keys", () => {
    expect(FLEET_WIDE_EXCEPTION_SEEDS).toHaveLength(12)
    for (const seed of FLEET_WIDE_EXCEPTION_SEEDS) {
      const validation = validateCanonicalKey(seed.canonicalKey)
      expect(validation.status, seed.canonicalKey).toBe("VALID")
      expect(validation.generation, seed.canonicalKey).toBe(seed.generation)
      expect(seed.physicalProofNote.trim().length).toBeGreaterThan(0)
    }
  })

  it("has no duplicate generation + key pairs", () => {
    const pairs = FLEET_WIDE_EXCEPTION_SEEDS.map(
      (seed) => `${seed.generation}:${seed.canonicalKey}`
    )
    expect(new Set(pairs).size).toBe(pairs.length)
  })
})
