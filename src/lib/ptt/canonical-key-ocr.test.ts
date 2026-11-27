import { describe, expect, it } from "vitest"

import { buildCanonicalKey, normalizeEcuAcronym, resolveV4Ecu } from "./canonical-key"

function key(controlUnit: string, faultCode: string, generation?: "FH_V3" | "FH_V4") {
  return buildCanonicalKey({ controlUnit, faultCode, generation })
}

describe("FH V4 OCR ECU aliases", () => {
  it.each([
    ["CCIODM", "CCIOM"],
    ["CCIOIM", "CCIOM"],
    ["CC1OM", "CCIOM"],
    ["CCI0M", "CCIOM"],
    ["CIM", "CCIOM"],
    ["Center Chassis I/O Module", "CCIOM"],
    ["Chassis I/O Module", "CCIOM"],
    ["CIOIM", "CIOM"],
    ["C1OM", "CIOM"],
    ["CI0M", "CIOM"],
    ["Cab I/O Module", "CIOM"],
    ["FCIOIM", "FCIOM"],
    ["FCI0M", "FCIOM"],
    ["Front Chassis I/O Module", "FCIOM"],
    ["RCIOIM", "RCIOM"],
    ["RCI0M", "RCIOM"],
    ["Rear Chassis I/O Module", "RCIOM"],
    ["HMIIOIM", "HMIIOM"],
    ["HM1IOM", "HMIIOM"],
    ["HMI I/O Module", "HMIIOM"],
    ["Human-Machine Interface I/O Module", "HMIIOM"],
    ["VMCUI", "VMCU"],
    ["Vehicle Master Control Unit", "VMCU"],
    ["Engine Control Module", "EMS"],
    ["Aftertreatment Control Module", "ACM"],
    ["Air Production Modulator", "APM"],
    ["Electronic Brake System", "EBS"],
    ["Antilock Brake System", "ABS"],
    ["Driver Door Module", "DDM"],
    ["Passenger Door Module", "PDM"],
    ["Transmission Electronic Control Unit", "TECU"],
    ["Gearbox Control Unit", "TECU"],
    ["Climate Control Module", "CCM"],
    ["Instrument Cluster", "IC"],
  ] as const)("normalises %s -> %s", (label, expected) => {
    expect(normalizeEcuAcronym(label)).toBe(expected)
  })

  it("is case-insensitive and ignores punctuation / spacing", () => {
    expect(normalizeEcuAcronym("c-c-i-o-d-m")).toBe("CCIOM")
    expect(normalizeEcuAcronym("  rear  CHASSIS  i/o  module ")).toBe("RCIOM")
  })

  it("never maps a Rear / Front chassis module to the generic chassis alias", () => {
    expect(normalizeEcuAcronym("Rear Chassis I/O Module")).toBe("RCIOM")
    expect(normalizeEcuAcronym("Front Chassis I/O Module")).toBe("FCIOM")
  })

  it("only accepts 'Cab Chassis I/O Module' when the DTC owner is CCIOM", () => {
    expect(normalizeEcuAcronym("Cab Chassis I/O Module")).toBeNull()
    expect(normalizeEcuAcronym("Cab Chassis I/O Module", "CIOM")).toBeNull()
    expect(normalizeEcuAcronym("Cab Chassis I/O Module", "CCIOM")).toBe("CCIOM")
  })
})

describe("FH V4 canonical keys for OCR-damaged ECU labels", () => {
  it("repairs CCIODM / CCIOIM / Cab Chassis I/O Module (CIM) on C103715", () => {
    for (const label of [
      "CCIODM",
      "CCIOIM",
      "Cab Chassis I/O Module (CIM)",
      "Cab Chassis I/O Module",
    ]) {
      const built = key(label, "C103715")
      expect(built.ok).toBe(true)
      if (built.ok) expect(built.key).toBe("CCIOM|C103715")
    }
  })

  it("maps FCIOIM / RCIOIM aliases", () => {
    const front = key("FCIOIM", "C108F15")
    const rear = key("RCIOIM", "C114864")
    expect(front.ok && front.key).toBe("FCIOM|C108F15")
    expect(rear.ok && rear.key).toBe("RCIOM|C114864")
  })

  it("maps CIM + C103715 to CCIOM", () => {
    const built = key("CIM", "C103715")
    expect(built.ok && built.key).toBe("CCIOM|C103715")
  })
})

describe("DTC-owner rescue (FH V4)", () => {
  it("rescues a garbled label from the DTC owner and records the hint", () => {
    const ebs = key("Elektronic Brake Sytem ???", "C006154")
    expect(ebs.ok).toBe(true)
    if (ebs.ok) {
      expect(ebs.key).toBe("EBS|C006154")
      expect(ebs.ecuRescuedFrom).toBe("Elektronic Brake Sytem ???")
    }
    const ddm = key("", "B150254")
    expect(ddm.ok && ddm.key).toBe("DDM|B150254")
    const ddmAlt = key("Drvr Door Modul", "B150254")
    expect(ddmAlt.ok && ddmAlt.key).toBe("DDM|B150254")
  })

  it("rescues from a near-miss acronym", () => {
    const built = key("EBZ", "C006154")
    expect(built.ok && built.key).toBe("EBS|C006154")
  })

  it("covers every ownership group", () => {
    const cases: Array<[string, string]> = [
      ["C101024", "APM"],
      ["U002886", "APM"],
      ["U300A62", "VMCU"],
      ["P107B13", "ACM"],
      ["P255613", "EMS"],
      ["C109015", "FCIOM"],
      ["B151095", "CIOM"],
      ["U10A500", "HMIIOM"],
      ["C100201", "ABS"],
    ]
    for (const [dtc, ecu] of cases) {
      const built = key("Unit not readable", dtc)
      expect(built.ok && built.key).toBe(`${ecu}|${dtc}`)
    }
  })

  it("overrides a contradicting known module (the DTC owner wins)", () => {
    const built = key("ABS", "C006154")
    expect(built.ok && built.key).toBe("EBS|C006154")
  })

  it("does not set the rescue hint when the label already resolved", () => {
    const built = key("Electronic Brake System (EBS)", "C006154")
    expect(built.ok).toBe(true)
    if (built.ok) expect(built.ecuRescuedFrom).toBeUndefined()
  })

  it("never rescues pure noise or unowned DTCs", () => {
    expect(key("Mystery Box (XYZ)", "P111D00").ok).toBe(false)
    expect(key("", "P999999").ok).toBe(false) // unowned DTC, no label
  })

  it("does not rescue on a truck registered as FH V3", () => {
    const resolved = resolveV4Ecu("Unit not readable", "C006154", false)
    expect(resolved.ecu).toBeNull()
    const built = key("Unit not readable", "C006154", "FH_V3")
    expect(built.ok).toBe(false)
  })
})
