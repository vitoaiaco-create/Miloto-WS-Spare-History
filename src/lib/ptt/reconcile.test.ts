import { describe, expect, it } from "vitest"

import type { PttFaultSeverity } from "../ptt-diagnostics"
import type { PttScanFaultStatus } from "./constants"
import { FLEET_WIDE_EXCEPTION_SEEDS } from "./exception-seed-data"
import {
  matchesApprovedException,
  reconcileDiagnosticScans,
  type ApprovedExceptionRule,
  type ReconcileFault,
} from "./reconcile"

// Real MTL41 (FH V3) before / after case.

const fault = (
  canonicalKey: string,
  severity: PttFaultSeverity = "MONITOR",
  pttStatus: PttScanFaultStatus = "ACTIVE"
): ReconcileFault => ({ canonicalKey, severity, pttStatus })

// Severities as classified on the baseline scan. The two persisting faults on
// the Vehicle / Engine ECUs that block sign-off are CRITICAL.
const SEVERITY: Record<string, PttFaultSeverity> = {
  "MID128|PID153|FMI5": "CRITICAL",
  "MID128|PID175|FMI5": "CRITICAL",
  "MID128|PID94|FMI5": "CRITICAL",
  "MID128|SID18|FMI5": "CALIBRATION_ONLY",
  "MID128|PID84|FMI9": "CRITICAL",
  "MID144|PID84|FMI2": "CRITICAL",
  "MID144|PPID3|FMI4": "MONITOR",
  "MID140|PSID210|FMI12": "MONITOR",
  "MID128|PID26|FMI3": "MONITOR",
}

const BASELINE_KEYS = [
  "MID128|PID153|FMI5",
  "MID128|PID175|FMI5",
  "MID128|PID84|FMI9",
  "MID128|PID94|FMI5",
  "MID128|SID18|FMI5",
  "MID140|PSID210|FMI12",
  "MID140|PSID214|FMI12",
  "MID140|PSID236|FMI12",
  "MID206|PSID10|FMI2",
  "MID206|PSID10|FMI7",
  "MID144|PID84|FMI2",
  "MID144|PPID3|FMI4",
  "MID144|PSID214|FMI9",
  "MID144|PSID23|FMI4",
  "MID144|PSID39|FMI4",
]

const VERIFICATION_KEYS = [
  "MID128|PID26|FMI3",
  "MID128|PID84|FMI9",
  "MID140|PSID210|FMI12",
  "MID140|PSID214|FMI12",
  "MID140|PSID236|FMI12",
  "MID206|PSID10|FMI2",
  "MID206|PSID10|FMI7",
  "MID144|PID84|FMI2",
  "MID144|PPID312|FMI7",
  "MID144|PPID3|FMI4",
  "MID144|PSID214|FMI9",
  "MID144|PSID23|FMI4",
  "MID144|PSID24|FMI4",
  "MID144|PSID39|FMI4",
]

const toFaults = (keys: string[]) =>
  keys.map((key) => fault(key, SEVERITY[key] ?? "MONITOR"))

// The confirmed fleet-wide exceptions, exactly as the seed script writes them.
const FLEET_EXCEPTIONS: ApprovedExceptionRule[] = FLEET_WIDE_EXCEPTION_SEEDS.map(
  (seed) => ({
    scope: "FLEET_GENERATION",
    generation: seed.generation,
    fleetId: null,
    canonicalKey: seed.canonicalKey,
    isActive: true,
  })
)

const sorted = (values: readonly string[]) => [...values].sort()
const keysOf = (faults: readonly { canonicalKey: string }[]) =>
  sorted(faults.map((f) => f.canonicalKey))

function reconcileMtl41() {
  return reconcileDiagnosticScans({
    fleetId: "MTL41",
    generation: "FH_V3",
    baselineFaults: toFaults(BASELINE_KEYS),
    verificationFaults: toFaults(VERIFICATION_KEYS),
    exceptions: FLEET_EXCEPTIONS,
  })
}

describe("reconcileDiagnosticScans - MTL41 (FH V3) real case", () => {
  it("has the documented fixture sizes (15 baseline, 14 verification)", () => {
    expect(BASELINE_KEYS).toHaveLength(15)
    expect(VERIFICATION_KEYS).toHaveLength(14)
  })

  it("classifies CLEARED (4)", () => {
    expect(keysOf(reconcileMtl41().buckets.CLEARED)).toEqual(
      sorted([
        "MID128|PID94|FMI5",
        "MID128|PID175|FMI5",
        "MID128|PID153|FMI5",
        "MID128|SID18|FMI5",
      ])
    )
  })

  it("classifies NEW_REGRESSION (1)", () => {
    expect(keysOf(reconcileMtl41().buckets.NEW_REGRESSION)).toEqual([
      "MID128|PID26|FMI3",
    ])
  })

  it("classifies NEW_EXCEPTION (2)", () => {
    expect(keysOf(reconcileMtl41().buckets.NEW_EXCEPTION)).toEqual(
      sorted(["MID144|PPID312|FMI7", "MID144|PSID24|FMI4"])
    )
  })

  it("classifies PERSISTING_OPEN (4)", () => {
    expect(keysOf(reconcileMtl41().buckets.PERSISTING_OPEN)).toEqual(
      sorted([
        "MID144|PID84|FMI2",
        "MID128|PID84|FMI9",
        "MID144|PPID3|FMI4",
        "MID140|PSID210|FMI12",
      ])
    )
  })

  it("classifies PERSISTING_EXCEPTION (7)", () => {
    expect(keysOf(reconcileMtl41().buckets.PERSISTING_EXCEPTION)).toEqual(
      sorted([
        "MID144|PSID23|FMI4",
        "MID144|PSID39|FMI4",
        "MID140|PSID214|FMI12",
        "MID144|PSID214|FMI9",
        "MID140|PSID236|FMI12",
        "MID206|PSID10|FMI2",
        "MID206|PSID10|FMI7",
      ])
    )
  })

  it("is PARTIAL_BLOCKED (progress made, but blockers and a regression remain)", () => {
    const result = reconcileMtl41()
    expect(result.caseStatus).toBe("PARTIAL_BLOCKED")
    expect(result.hasBlockingPersisting).toBe(true)
    expect(result.hasRegressions).toBe(true)
    expect(result.clearedActionableCount).toBe(4)
  })

  it("keeps every fault in exactly one bucket and balances the equation", () => {
    const result = reconcileMtl41()
    const { summary } = result
    expect(summary).toEqual({
      baselineActiveCount: 15,
      verificationActiveCount: 14,
      clearedCount: 4,
      persistingOpenCount: 4,
      persistingExceptionCount: 7,
      newRegressionCount: 1,
      newExceptionCount: 2,
      bounceBackCount: 0,
    })
    // Baseline Active - Cleared + New Regressions + New Exceptions = Verification Active
    expect(
      summary.baselineActiveCount -
        summary.clearedCount +
        summary.newRegressionCount +
        summary.newExceptionCount
    ).toBe(summary.verificationActiveCount)

    const keys = result.faults.map((f) => f.canonicalKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toHaveLength(4 + 4 + 7 + 1 + 2)
  })

  it("is independent of input order", () => {
    const shuffled = reconcileDiagnosticScans({
      fleetId: "mtl41 ",
      generation: "FH_V3",
      baselineFaults: toFaults([...BASELINE_KEYS].reverse()),
      verificationFaults: toFaults([...VERIFICATION_KEYS].reverse()),
      exceptions: [...FLEET_EXCEPTIONS].reverse(),
    })
    expect(shuffled.faults).toEqual(reconcileMtl41().faults)
    expect(shuffled.summary).toEqual(reconcileMtl41().summary)
  })
})

describe("reconcileDiagnosticScans - closure gate", () => {
  it("rejects a case with zero progress (0 cleared) as REJECTED_NO_PROGRESS", () => {
    const baseline = [
      fault("MID128|PID94|FMI5", "CRITICAL"),
      fault("MID144|PID84|FMI2", "CRITICAL"),
    ]
    const result = reconcileDiagnosticScans({
      fleetId: "MTL41",
      generation: "FH_V3",
      baselineFaults: baseline,
      // The workshop re-scanned and nothing changed.
      verificationFaults: baseline,
      exceptions: FLEET_EXCEPTIONS,
    })
    expect(result.summary.clearedCount).toBe(0)
    expect(result.clearedActionableCount).toBe(0)
    expect(result.caseStatus).toBe("REJECTED_NO_PROGRESS")
  })

  it("does not count a cleared approved exception as actionable progress", () => {
    const result = reconcileDiagnosticScans({
      fleetId: "MTL41",
      generation: "FH_V3",
      baselineFaults: [
        fault("MID144|PSID23|FMI4"), // exception, will clear
        fault("MID128|PID94|FMI5", "CRITICAL"), // blocker, persists
      ],
      verificationFaults: [fault("MID128|PID94|FMI5", "CRITICAL")],
      exceptions: FLEET_EXCEPTIONS,
    })
    expect(result.buckets.CLEARED).toHaveLength(1)
    expect(result.clearedActionableCount).toBe(0)
    expect(result.caseStatus).toBe("REJECTED_NO_PROGRESS")
  })

  it("rejects when the only change is a new regression and nothing was cleared", () => {
    const result = reconcileDiagnosticScans({
      fleetId: "MTL41",
      generation: "FH_V3",
      baselineFaults: [fault("MID144|PPID3|FMI4")],
      verificationFaults: [
        fault("MID144|PPID3|FMI4"),
        fault("MID128|PID26|FMI3"),
      ],
      exceptions: [],
    })
    expect(result.caseStatus).toBe("REJECTED_NO_PROGRESS")
  })

  it("is VERIFIED_CLOSED when only monitor-level or exempt faults remain", () => {
    const result = reconcileDiagnosticScans({
      fleetId: "MTL41",
      generation: "FH_V3",
      baselineFaults: [
        fault("MID128|PID94|FMI5", "CRITICAL"),
        fault("MID144|PPID3|FMI4", "MONITOR"),
        fault("MID144|PSID23|FMI4", "CRITICAL"),
      ],
      verificationFaults: [
        fault("MID144|PPID3|FMI4", "MONITOR"),
        fault("MID144|PSID23|FMI4", "CRITICAL"),
        fault("MID144|PSID24|FMI4", "CRITICAL"),
      ],
      exceptions: FLEET_EXCEPTIONS,
    })
    expect(result.hasBlockingPersisting).toBe(false)
    expect(result.hasRegressions).toBe(false)
    expect(result.caseStatus).toBe("VERIFIED_CLOSED")
  })

  it("treats a persisting CALIBRATION_ONLY fault as blocking", () => {
    const result = reconcileDiagnosticScans({
      fleetId: "MTL41",
      generation: "FH_V3",
      baselineFaults: [
        fault("MID128|PID94|FMI5", "CRITICAL"),
        fault("MID130|SID11|FMI4", "CALIBRATION_ONLY"),
      ],
      verificationFaults: [fault("MID130|SID11|FMI4", "CALIBRATION_ONLY")],
      exceptions: [],
    })
    expect(result.hasBlockingPersisting).toBe(true)
    expect(result.caseStatus).toBe("PARTIAL_BLOCKED")
  })

  it("counts a fault shown INACTIVE on the verification scan as CLEARED", () => {
    const result = reconcileDiagnosticScans({
      fleetId: "MTL41",
      generation: "FH_V3",
      baselineFaults: [fault("MID128|PID94|FMI5", "CRITICAL")],
      verificationFaults: [fault("MID128|PID94|FMI5", "CRITICAL", "INACTIVE")],
      exceptions: [],
    })
    expect(keysOf(result.buckets.CLEARED)).toEqual(["MID128|PID94|FMI5"])
    expect(result.caseStatus).toBe("VERIFIED_CLOSED")
  })

  it("ignores INACTIVE baseline faults and an INACTIVE-then-ACTIVE fault is a regression", () => {
    const result = reconcileDiagnosticScans({
      fleetId: "MTL41",
      generation: "FH_V3",
      baselineFaults: [
        fault("MID128|PID94|FMI5", "CRITICAL", "INACTIVE"),
        fault("MID144|PPID3|FMI4", "MONITOR"),
      ],
      verificationFaults: [fault("MID128|PID94|FMI5", "CRITICAL")],
      exceptions: [],
    })
    expect(result.summary.baselineActiveCount).toBe(1)
    expect(keysOf(result.buckets.NEW_REGRESSION)).toEqual(["MID128|PID94|FMI5"])
    expect(keysOf(result.buckets.CLEARED)).toEqual(["MID144|PPID3|FMI4"])
  })

  it("counts bounce-back keys in the summary", () => {
    const result = reconcileDiagnosticScans({
      fleetId: "MTL41",
      generation: "FH_V3",
      baselineFaults: [fault("MID144|PPID3|FMI4")],
      verificationFaults: [fault("MID128|PID94|FMI5", "CRITICAL")],
      exceptions: [],
      bounceBackKeys: new Set(["MID128|PID94|FMI5"]),
    })
    expect(result.summary.bounceBackCount).toBe(1)
    expect(result.buckets.NEW_REGRESSION[0].isBounceBack).toBe(true)
  })
})

describe("matchesApprovedException", () => {
  const key = "MID144|PSID23|FMI4"

  it("matches a FLEET_GENERATION rule only for that generation", () => {
    expect(matchesApprovedException(FLEET_EXCEPTIONS, "MTL41", "FH_V3", key)).toBe(true)
    expect(matchesApprovedException(FLEET_EXCEPTIONS, "MTL41", "FH_V4", key)).toBe(false)
    expect(matchesApprovedException(FLEET_EXCEPTIONS, "MTL41", "UNKNOWN", key)).toBe(false)
  })

  it("matches a TRUCK_SPECIFIC rule only for that fleet id (case-insensitive)", () => {
    const rules: ApprovedExceptionRule[] = [
      {
        scope: "TRUCK_SPECIFIC",
        generation: null,
        fleetId: "MTL41",
        canonicalKey: "MID128|PID94|FMI5",
        isActive: true,
      },
    ]
    expect(matchesApprovedException(rules, " mtl41", "FH_V3", "MID128|PID94|FMI5")).toBe(true)
    expect(matchesApprovedException(rules, "MTL42", "FH_V3", "MID128|PID94|FMI5")).toBe(false)
  })

  it("ignores deactivated rules", () => {
    const rules = FLEET_EXCEPTIONS.map((rule) => ({ ...rule, isActive: false }))
    expect(matchesApprovedException(rules, "MTL41", "FH_V3", key)).toBe(false)
  })
})
