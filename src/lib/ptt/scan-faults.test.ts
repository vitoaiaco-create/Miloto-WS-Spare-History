import { describe, expect, it } from "vitest"

import {
  buildScanFaultRecords,
  countExtractedDtcRows,
  isVcadsSuccessMessage,
  toScanFaultStatus,
  type ExtractedFaultInput,
} from "./scan-faults"

const row = (
  overrides: Partial<ExtractedFaultInput> = {}
): ExtractedFaultInput => ({
  controlUnit: "Engine ECU (MID 128)",
  faultCode: "PID 175 FMI 5",
  description: "Oil temperature",
  faultState: "ACTIVE",
  severity: "MONITOR",
  ...overrides,
})

describe("buildScanFaultRecords", () => {
  it("stores the canonical key next to the raw ECU label and DTC", () => {
    const [record] = buildScanFaultRecords([row()], "FH_V3")
    expect(record).toMatchObject({
      canonicalKey: "MID128|PID175|FMI5",
      ecuLabel: "Engine ECU (MID 128)",
      dtcRaw: "PID 175 FMI 5",
      pttStatus: "ACTIVE",
      keyNeedsReview: false,
      isVcads: false,
    })
  })

  it("merges rows that normalise to the same key (ACTIVE and worse severity win)", () => {
    const records = buildScanFaultRecords(
      [
        row({ faultState: "INACTIVE", severity: "CRITICAL", description: "short" }),
        row({
          controlUnit: "ENGINE ECU ( MID 128 )",
          faultCode: "pid175 fmi5",
          faultState: "ACTIVE",
          severity: "NEGLIGIBLE",
          description: "a much longer description",
        }),
      ],
      "FH_V3"
    )
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      pttStatus: "ACTIVE",
      severity: "CRITICAL",
      description: "a much longer description",
    })
  })

  it("stores unreadable rows under a fallback key and flags them for review", () => {
    const [record] = buildScanFaultRecords(
      [row({ controlUnit: "Engine ECU", faultCode: "PID 175 FMI 5" })],
      "FH_V3"
    )
    expect(record.canonicalKey.startsWith("UNVERIFIED|")).toBe(true)
    expect(record.keyNeedsReview).toBe(true)
    expect(record.keyReviewReason).toContain("MID")
  })

  it("flags OCR-suspicious keys but keeps them diffable", () => {
    const [record] = buildScanFaultRecords(
      [row({ faultCode: "PID 175 FMI 44" })],
      "FH_V3"
    )
    expect(record.canonicalKey).toBe("MID128|PID175|FMI44")
    expect(record.keyNeedsReview).toBe(true)
  })

  it("keys VCADS pop-ups as VCADS|OP<n> and excludes them from the DTC row count", () => {
    const records = buildScanFaultRecords(
      [
        row(),
        row({
          controlUnit: "TECU / Clutch Calibration",
          faultCode: "VCADS-OP-37",
          description: "Operation failed",
        }),
      ],
      "FH_V3"
    )
    const vcads = records.find((r) => r.isVcads)
    expect(vcads?.canonicalKey).toBe("VCADS|OP37")
    expect(vcads?.keyNeedsReview).toBe(false)
    expect(records).toHaveLength(2)
    expect(countExtractedDtcRows(records)).toBe(1)
  })

  it("builds V4 keys", () => {
    const [record] = buildScanFaultRecords(
      [row({ controlUnit: "Engine Control Module (EMS)", faultCode: "P111D00" })],
      "FH_V4"
    )
    expect(record.canonicalKey).toBe("EMS|P111D00")
  })
})

describe("toScanFaultStatus", () => {
  it("keeps unreadable (UNKNOWN) states ACTIVE so they are never credited as cleared", () => {
    expect(toScanFaultStatus("UNKNOWN")).toBe("ACTIVE")
    expect(toScanFaultStatus("ACTIVE")).toBe("ACTIVE")
    expect(toScanFaultStatus("INACTIVE")).toBe("INACTIVE")
  })
})

describe("isVcadsSuccessMessage", () => {
  it("recognises a completed operation", () => {
    expect(isVcadsSuccessMessage("Operation completed successfully")).toBe(true)
  })
  it.each([
    "Operation failed: input shaft speed missing",
    "Calibration not completed",
    "Error: engine speed too low",
    "Please wait",
  ])("keeps %j ACTIVE", (message) => {
    expect(isVcadsSuccessMessage(message)).toBe(false)
  })
})
