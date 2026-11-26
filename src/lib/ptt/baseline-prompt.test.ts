import { describe, expect, it } from "vitest"

import {
  BASELINE_SYSTEM_PROMPT,
  buildBaselinePass2Payload,
  type BaselineClassifiedRow,
  type BaselinePayloadInput,
} from "./baseline-prompt"
import { buildFleetPatternPayload, detectFleetPatterns } from "./severity-and-patterns"

const row = (
  n: number,
  canonicalKey: string,
  overrides: Partial<BaselineClassifiedRow> = {}
): BaselineClassifiedRow => ({
  row: n,
  canonicalKey,
  controlUnit: "Engine ECU (MID 128)",
  faultCode: canonicalKey,
  codeFormat: "V3_MID_FMI",
  description: canonicalKey,
  state: "ACTIVE",
  count: 1,
  severity: "CRITICAL",
  isApprovedException: false,
  ...overrides,
})

function payloadFor(rows: BaselineClassifiedRow[]) {
  const input: BaselinePayloadInput = {
    fleetId: "MTL41",
    generation: "FH_V3",
    odometerKm: 120000,
    scanBatch: null,
    today: "2026-11-26",
    rows,
    popups: [],
    fleetPatterns: buildFleetPatternPayload(detectFleetPatterns([])),
    workshopContext: null,
    spares: [],
    priorScans: "No prior PTT scans on file for this truck.",
    transcriptionWarning: null,
  }
  return JSON.parse(buildBaselinePass2Payload(input)) as {
    mode: string
    actionableFaults: Array<{ row: number; calibrationRequired: boolean }>
    monitorFaults: Array<{ row: number }>
    approvedExceptions: Array<{ row: number }>
    inactiveFaults: Array<{ row: number }>
    fleetPatterns: { flags: Record<string, boolean> }
  }
}

describe("buildBaselinePass2Payload", () => {
  it("splits rows into pre-classified buckets; exceptions win over any tier", () => {
    const payload = payloadFor([
      row(1, "MID128|PID175|FMI5"),
      row(2, "EBS|C006154", { severity: "CALIBRATION_ONLY" }),
      row(3, "MID130|PSID20|FMI5", { severity: "MONITOR" }),
      row(4, "MID144|PSID23|FMI5", {
        severity: "NEGLIGIBLE",
        isApprovedException: true,
      }),
      row(5, "MID128|PID94|FMI3", { severity: "NEGLIGIBLE", state: "INACTIVE" }),
    ])

    expect(payload.mode).toBe("BASELINE")
    expect(payload.actionableFaults.map((f) => f.row)).toEqual([1, 2])
    expect(payload.actionableFaults[1].calibrationRequired).toBe(true)
    expect(payload.monitorFaults.map((f) => f.row)).toEqual([3])
    expect(payload.approvedExceptions.map((f) => f.row)).toEqual([4])
    expect(payload.inactiveFaults.map((f) => f.row)).toEqual([5])
  })

  it("carries every row exactly once", () => {
    const rows = [
      row(1, "MID128|PID175|FMI5"),
      row(2, "MID130|PSID20|FMI5", { severity: "MONITOR" }),
      row(3, "MID144|PSID23|FMI5", { severity: "NEGLIGIBLE", isApprovedException: true }),
    ]
    const payload = payloadFor(rows)
    const total =
      payload.actionableFaults.length +
      payload.monitorFaults.length +
      payload.approvedExceptions.length +
      payload.inactiveFaults.length
    expect(total).toBe(rows.length)
  })
})

describe("BASELINE_SYSTEM_PROMPT", () => {
  it("declares BASELINE mode and locks severity", () => {
    expect(BASELINE_SYSTEM_PROMPT).toMatch(/^MODE: BASELINE/)
    expect(BASELINE_SYSTEM_PROMPT).toMatch(/SEVERITY IS LOCKED/)
  })

  it("enforces 100% actionable coverage and exception silence", () => {
    expect(BASELINE_SYSTEM_PROMPT).toMatch(/100% ACTIONABLE COVERAGE/)
    expect(BASELINE_SYSTEM_PROMPT).toMatch(/STRICT EXCEPTION SILENCE/)
    expect(BASELINE_SYSTEM_PROMPT).toContain("PSID 39")
  })

  it("carries the 24V and FMI physics rules", () => {
    expect(BASELINE_SYSTEM_PROMPT).toMatch(/24V/)
    expect(BASELINE_SYSTEM_PROMPT).toMatch(/NEVER write a 12V or 10V threshold/)
    expect(BASELINE_SYSTEM_PROMPT).toMatch(/ACTIVE SHORT TO GROUND/)
    expect(BASELINE_SYSTEM_PROMPT).toMatch(/P255800/)
  })

  it("carries the exact Volvo FH V3 / V4 accuracy rules", () => {
    for (const fragment of [
      "KBQ / KBR",
      "9.5-12 bar",
      "Reset Air Dryer Cartridge",
      "10-second manual cab window switch reset",
      "NEVER call them \"software updates\"",
      "activeMandates",
    ]) {
      expect(BASELINE_SYSTEM_PROMPT).toContain(fragment)
    }
  })
})
