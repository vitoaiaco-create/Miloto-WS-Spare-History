import { describe, expect, it } from "vitest"

import type { PttFault } from "../ptt-diagnostics"
import type { ApprovedExceptionRule } from "./reconcile"
import {
  FLEET_PATTERN_FLAGS,
  applyDeterministicSeverity,
  buildFleetPatternPayload,
  classifyFaultSeverity,
  detectFleetPatterns,
  matchesKeyPattern,
  resolveSeverity,
  type PatternFault,
  type SeverityContext,
  type SeverityFaultInput,
} from "./severity-and-patterns"

const NO_EXCEPTIONS: ApprovedExceptionRule[] = []

function context(
  overrides: Partial<SeverityContext> = {}
): SeverityContext {
  return {
    fleetId: "MTL41",
    generation: "FH_V3",
    exceptions: NO_EXCEPTIONS,
    ...overrides,
  }
}

const active = (
  canonicalKey: string,
  extra: Partial<SeverityFaultInput> = {}
): SeverityFaultInput => ({ canonicalKey, pttStatus: "ACTIVE", ...extra })

const tier = (key: string, ctx: SeverityContext = context()) =>
  classifyFaultSeverity(active(key), ctx).severity

describe("matchesKeyPattern", () => {
  it("matches exact keys and treats * as a wildcard", () => {
    expect(matchesKeyPattern("MID128|PID175|FMI5", "MID128|PID175|FMI*")).toBe(true)
    expect(matchesKeyPattern("MID128|PID175|FMI12", "MID128|PID175|FMI*")).toBe(true)
    expect(matchesKeyPattern("MID128|PID1750|FMI5", "MID128|PID175|FMI*")).toBe(false)
    expect(matchesKeyPattern("MID130|PID37|FMI12", "MID130|PID37|FMI1")).toBe(false)
    expect(matchesKeyPattern("MID216|PSID8|FMI6", "MID216|*|FMI6")).toBe(true)
    expect(matchesKeyPattern("MID216|PSID8|FMI60", "MID216|*|FMI6")).toBe(false)
    expect(matchesKeyPattern("MID146|SID11|FMI5", "MID146|*")).toBe(true)
  })
})

describe("classifyFaultSeverity: precedence", () => {
  it("1. INACTIVE is NEGLIGIBLE, even for a locked CRITICAL key", () => {
    const decision = classifyFaultSeverity(
      { canonicalKey: "MID128|PID175|FMI5", pttStatus: "INACTIVE" },
      context()
    )
    expect(decision.severity).toBe("NEGLIGIBLE")
    expect(decision.source).toBe("INACTIVE")
  })

  it("2. an approved exception is NEGLIGIBLE and flagged, even for a CRITICAL key", () => {
    const exceptions: ApprovedExceptionRule[] = [
      {
        scope: "FLEET_GENERATION",
        generation: "FH_V3",
        fleetId: null,
        canonicalKey: "MID144|PSID23|FMI5",
        isActive: true,
      },
      {
        scope: "TRUCK_SPECIFIC",
        generation: null,
        fleetId: "MTL41",
        canonicalKey: "MID128|PID175|FMI5",
        isActive: true,
      },
    ]
    const ctx = context({ exceptions })

    const fleetWide = classifyFaultSeverity(active("MID144|PSID23|FMI5"), ctx)
    expect(fleetWide).toMatchObject({
      severity: "NEGLIGIBLE",
      source: "APPROVED_EXCEPTION",
      isApprovedException: true,
    })
    // Exception beats the locked CRITICAL rule.
    expect(tier("MID128|PID175|FMI5", ctx)).toBe("NEGLIGIBLE")
    // A different truck is not covered by the truck-specific exception.
    expect(
      tier("MID128|PID175|FMI5", context({ exceptions, fleetId: "MTL99" }))
    ).toBe("CRITICAL")
  })

  it("an inactive exception row is still flagged as an exception", () => {
    const exceptions: ApprovedExceptionRule[] = [
      {
        scope: "TRUCK_SPECIFIC",
        generation: null,
        fleetId: "MTL41",
        canonicalKey: "MID249|SID1|FMI5",
        isActive: true,
      },
    ]
    const decision = classifyFaultSeverity(
      { canonicalKey: "MID249|SID1|FMI5", pttStatus: "INACTIVE" },
      context({ exceptions })
    )
    expect(decision).toMatchObject({
      severity: "NEGLIGIBLE",
      isApprovedException: true,
    })
  })

  it("an inactive (deactivated) exception rule does not apply", () => {
    const exceptions: ApprovedExceptionRule[] = [
      {
        scope: "TRUCK_SPECIFIC",
        generation: null,
        fleetId: "MTL41",
        canonicalKey: "MID128|PID175|FMI5",
        isActive: false,
      },
    ]
    expect(tier("MID128|PID175|FMI5", context({ exceptions }))).toBe("CRITICAL")
  })
})

describe("classifyFaultSeverity: locked CALIBRATION", () => {
  it.each([
    "DDM|B150254",
    "CCIOM|C10F054",
    "EBS|C006154",
    "MID223|SID253|FMI2",
  ])("%s -> CALIBRATION_ONLY", (key) => {
    const ctx = context({ generation: key.startsWith("MID") ? "FH_V3" : "FH_V4" })
    expect(tier(key, ctx)).toBe("CALIBRATION_ONLY")
  })

  it("any FH V4 DTC ending in 54 is a missing calibration", () => {
    const ctx = context({ generation: "FH_V4" })
    expect(tier("VMCU|U300054", ctx)).toBe("CALIBRATION_ONLY")
    expect(tier("TECU|P105F54", ctx)).toBe("CALIBRATION_ONLY")
    // ...and a non-54 TECU fault is the locked CRITICAL rule instead.
    expect(tier("TECU|P105F18", ctx)).toBe("CRITICAL")
  })

  it("an approved exception beats the calibration rule", () => {
    const exceptions: ApprovedExceptionRule[] = [
      {
        scope: "FLEET_GENERATION",
        generation: "FH_V4",
        fleetId: null,
        canonicalKey: "EBS|C006154",
        isActive: true,
      },
    ]
    expect(
      tier("EBS|C006154", context({ generation: "FH_V4", exceptions }))
    ).toBe("NEGLIGIBLE")
  })
})

describe("classifyFaultSeverity: locked CRITICAL", () => {
  it.each([
    "MID128|PID175|FMI5",
    "MID128|PID175|FMI3",
    "MID128|PID94|FMI3",
    "MID128|PID110|FMI0",
    "MID128|PID100|FMI1",
    "MID130|PID37|FMI1",
    "MID130|PSID27|FMI8",
    "MID130|PID160|FMI2",
    "MID136|SID1|FMI4",
    "MID136|SID2|FMI2",
    "MID136|SID5|FMI3",
    "MID140|PID118|FMI1",
    "MID216|PSID8|FMI6",
    "MID216|PSID26|FMI6",
    "MID144|PID84|FMI2",
    "MID128|PID84|FMI9",
    "MID144|PPID3|FMI4",
  ])("FH V3 %s -> CRITICAL", (key) => {
    expect(tier(key)).toBe("CRITICAL")
  })

  it.each([
    "EMS|P255613",
    "EMS|P255800",
    "EMS|P111D00",
    "ABS|C100201",
    "TECU|P105F18",
    "TECU|U100087",
    "VMCU|U300A62",
  ])("FH V4 %s -> CRITICAL", (key) => {
    expect(tier(key, context({ generation: "FH_V4" }))).toBe("CRITICAL")
  })

  it("an FH V4 ABS / EBS wheel-speed-sensor electrical fault is CRITICAL", () => {
    const ctx = context({ generation: "FH_V4" })
    expect(
      classifyFaultSeverity(
        active("EBS|C100313", { description: "Wheel Speed Sensor Front Left - Circuit Open" }),
        ctx
      ).severity
    ).toBe("CRITICAL")
    // Without the wheel-speed wording it falls through to the fallback (MONITOR).
    expect(
      classifyFaultSeverity(active("EBS|C100313", { description: "Brake pad wear" }), ctx)
        .severity
    ).toBe("MONITOR")
  })

  it("MID 130 PID 37 only escalates for FMI 1", () => {
    // FMI 2 on the gearbox ECU is not a locked key: deterministic fallback
    // (an ACTIVE fault on a safety ECU is still CRITICAL).
    const decision = classifyFaultSeverity(
      active("MID130|PID37|FMI2", { ecuLabel: "Gearbox ECU (MID 130)" }),
      context()
    )
    expect(decision.source).toBe("FALLBACK")
  })
})

describe("classifyFaultSeverity: locked MONITOR", () => {
  it.each([
    "MID128|SID18|FMI5",
    "MID128|PID153|FMI5",
    "MID128|PID107|FMI5",
    "MID128|PID173|FMI5",
    "MID128|PPID124|FMI5",
    "MID130|PSID20|FMI5",
    "MID130|PSID208|FMI9",
    "MID140|PID171|FMI5",
    "MID128|PID171|FMI3",
    "MID140|PID96|FMI5",
    "MID140|PSID45|FMI4",
    "MID140|PSID46|FMI5",
    "MID140|PSID47|FMI2",
    "MID146|SID11|FMI5",
    "MID146|PID1|FMI12",
    "MID216|PSID10|FMI5",
    "MID216|PSID11|FMI4",
  ])("FH V3 %s -> MONITOR", (key) => {
    expect(tier(key)).toBe("MONITOR")
  })

  it.each([
    "APM|C101068",
    "EMS|P101713",
    "EMS|P10F800",
    "CIOM|B151095",
    "CIOM|U114E87",
    "CCIOM|U114187",
    "HMIIOM|U10A500",
    "RCIOM|C10D616",
  ])("FH V4 %s -> MONITOR", (key) => {
    const decision = classifyFaultSeverity(
      active(key),
      context({ generation: "FH_V4" })
    )
    expect(decision.severity).toBe("MONITOR")
    expect(decision.source).toBe("LOCKED_MONITOR")
  })

  it("a MONITOR key is never escalated by the fallback", () => {
    // MID 128 is a safety ECU (fallback = CRITICAL) but this key is locked MONITOR.
    const decision = classifyFaultSeverity(
      active("MID128|SID18|FMI5", { ecuLabel: "Engine ECU (MID 128)" }),
      context()
    )
    expect(decision).toMatchObject({ severity: "MONITOR", source: "LOCKED_MONITOR" })
  })
})

describe("classifyFaultSeverity: fallback", () => {
  it("uses the existing deterministic fallback for unseen active codes", () => {
    const engine = classifyFaultSeverity(
      active("MID128|PID999|FMI3", { ecuLabel: "Engine ECU (MID 128)" }),
      context()
    )
    expect(engine).toMatchObject({ severity: "CRITICAL", source: "FALLBACK" })

    const lamps = classifyFaultSeverity(
      active("MID216|PSID99|FMI3", { ecuLabel: "Light Control Module (MID 216)" }),
      context()
    )
    expect(lamps).toMatchObject({ severity: "MONITOR", source: "FALLBACK" })
  })

  it("keeps a failed VCADS operation CRITICAL", () => {
    expect(tier("VCADS|OP37")).toBe("CRITICAL")
  })

  it("resolveSeverity keeps the caller's prior tier only for fallback decisions", () => {
    const locked = classifyFaultSeverity(active("MID130|PSID20|FMI5"), context())
    expect(resolveSeverity(locked, "CRITICAL")).toBe("MONITOR")

    const fallback = classifyFaultSeverity(
      active("MID216|PSID99|FMI3", { ecuLabel: "LCM (MID 216)" }),
      context()
    )
    expect(resolveSeverity(fallback, "CALIBRATION_ONLY")).toBe("CALIBRATION_ONLY")
  })
})

describe("applyDeterministicSeverity", () => {
  const model = (overrides: Partial<PttFault>): PttFault => ({
    fault_code: "PID 175 FMI 5",
    code_format: "V3_MID_FMI",
    control_unit: "Engine ECU (MID 128)",
    component_description: "Engine oil temperature",
    fault_state: "ACTIVE",
    occurrence_count: 1,
    severity: "MONITOR",
    root_cause_summary: "Model said monitor.",
    calibration_required: false,
    source_row: 1,
    ...overrides,
  })

  it("overrides whatever tier the model returned", () => {
    const [fixed] = applyDeterministicSeverity([model({})], context())
    expect(fixed.severity).toBe("CRITICAL")
    expect(fixed.calibration_required).toBe(false)

    const [calibration] = applyDeterministicSeverity(
      [
        model({
          fault_code: "C006154",
          control_unit: "Brake System (EBS)",
          code_format: "V4_UDS",
          severity: "CRITICAL",
        }),
      ],
      context({ generation: "FH_V4" })
    )
    expect(calibration.severity).toBe("CALIBRATION_ONLY")
    expect(calibration.calibration_required).toBe(true)
  })

  it("silences approved exceptions", () => {
    const exceptions: ApprovedExceptionRule[] = [
      {
        scope: "TRUCK_SPECIFIC",
        generation: null,
        fleetId: "MTL41",
        canonicalKey: "MID128|PID175|FMI5",
        isActive: true,
      },
    ]
    const [fixed] = applyDeterministicSeverity([model({})], context({ exceptions }))
    expect(fixed.severity).toBe("NEGLIGIBLE")
    expect(fixed.root_cause_summary).toBe("Approved exception - no action required.")
  })

  it("treats an INACTIVE row as NEGLIGIBLE", () => {
    const [fixed] = applyDeterministicSeverity(
      [model({ fault_state: "INACTIVE" })],
      context()
    )
    expect(fixed.severity).toBe("NEGLIGIBLE")
  })
})

// ---------------------------------------------------------------------------
// Fleet patterns
// ---------------------------------------------------------------------------

const on = (...keys: string[]): PatternFault[] =>
  keys.map((canonicalKey) => ({ canonicalKey, pttStatus: "ACTIVE" }))

describe("detectFleetPatterns", () => {
  it("is all false for an empty scan", () => {
    const flags = detectFleetPatterns([])
    for (const flag of FLEET_PATTERN_FLAGS) expect(flags[flag]).toBe(false)
  })

  describe("isLcmOffline", () => {
    it("is true when PSID 210 FMI 12 is active and the scan has no MID 216 row", () => {
      expect(
        detectFleetPatterns(on("MID140|PSID210|FMI12", "MID128|PID175|FMI5"))
          .isLcmOffline
      ).toBe(true)
    })

    it("is false when any MID 216 row exists", () => {
      expect(
        detectFleetPatterns(on("MID140|PSID210|FMI12", "MID216|PSID10|FMI5"))
          .isLcmOffline
      ).toBe(false)
      // An INACTIVE MID 216 row still counts as a row.
      expect(
        detectFleetPatterns([
          ...on("MID140|PSID210|FMI12"),
          { canonicalKey: "MID216|PSID10|FMI5", pttStatus: "INACTIVE" },
        ]).isLcmOffline
      ).toBe(false)
    })

    it("is false when PSID 210 FMI 12 is not active", () => {
      expect(detectFleetPatterns([]).isLcmOffline).toBe(false)
      expect(
        detectFleetPatterns([
          { canonicalKey: "MID140|PSID210|FMI12", pttStatus: "INACTIVE" },
        ]).isLcmOffline
      ).toBe(false)
    })
  })

  describe("retarderClusterOpen", () => {
    it("FH V3: 3+ active MID 222 FMI 5 codes", () => {
      expect(
        detectFleetPatterns(
          on("MID222|PID110|FMI5", "MID222|PID120|FMI5", "MID222|PPID31|FMI5")
        ).retarderClusterOpen
      ).toBe(true)
      expect(
        detectFleetPatterns(
          on(
            "MID222|PID110|FMI5",
            "MID222|PID120|FMI5",
            "MID222|PPID31|FMI5",
            "MID222|SID2|FMI5"
          )
        ).retarderClusterOpen
      ).toBe(true)
    })

    it("FH V3: fewer than 3, or a different FMI, does not trigger", () => {
      expect(
        detectFleetPatterns(on("MID222|PID110|FMI5", "MID222|PID120|FMI5"))
          .retarderClusterOpen
      ).toBe(false)
      expect(
        detectFleetPatterns(
          on("MID222|PID110|FMI3", "MID222|PID120|FMI3", "MID222|PPID31|FMI3")
        ).retarderClusterOpen
      ).toBe(false)
    })

    it("FH V4: 3+ ACM retarder open codes", () => {
      expect(
        detectFleetPatterns(on("ACM|P107B13", "ACM|P107C13", "ACM|P107D13"))
          .retarderClusterOpen
      ).toBe(true)
      expect(
        detectFleetPatterns(on("ACM|P107B13", "ACM|P107C13"))
          .retarderClusterOpen
      ).toBe(false)
    })

    it("approved-exception retarder faults (non-retarder gearbox) do not count", () => {
      expect(
        detectFleetPatterns(
          ["MID222|PID110|FMI5", "MID222|PID120|FMI5", "MID222|PPID31|FMI5"].map(
            (canonicalKey): PatternFault => ({
              canonicalKey,
              pttStatus: "ACTIVE",
              isApprovedException: true,
            })
          )
        ).retarderClusterOpen
      ).toBe(false)
    })
  })

  describe("absToGearboxRipple", () => {
    it("is true when PSID 204 FMI 8 is active with an active MID 136 fault", () => {
      expect(
        detectFleetPatterns(on("MID130|PSID204|FMI8", "MID136|SID2|FMI4"))
          .absToGearboxRipple
      ).toBe(true)
    })

    it("is false without the ABS fault or without PSID 204 FMI 8", () => {
      expect(
        detectFleetPatterns(on("MID130|PSID204|FMI8")).absToGearboxRipple
      ).toBe(false)
      expect(
        detectFleetPatterns(on("MID136|SID2|FMI4")).absToGearboxRipple
      ).toBe(false)
    })
  })

  describe("roadSpeedPair", () => {
    it("needs BOTH MID 144 PID 84 FMI 2 and MID 128 PID 84 FMI 9", () => {
      expect(
        detectFleetPatterns(on("MID144|PID84|FMI2", "MID128|PID84|FMI9"))
          .roadSpeedPair
      ).toBe(true)
      expect(detectFleetPatterns(on("MID144|PID84|FMI2")).roadSpeedPair).toBe(false)
      expect(detectFleetPatterns(on("MID128|PID84|FMI9")).roadSpeedPair).toBe(false)
    })
  })

  describe("vmcuKeyToApmRipple", () => {
    it("needs BOTH VMCU U300A62 and APM U002886", () => {
      expect(
        detectFleetPatterns(on("VMCU|U300A62", "APM|U002886")).vmcuKeyToApmRipple
      ).toBe(true)
      expect(detectFleetPatterns(on("VMCU|U300A62")).vmcuKeyToApmRipple).toBe(false)
      expect(detectFleetPatterns(on("APM|U002886")).vmcuKeyToApmRipple).toBe(false)
    })
  })

  describe("mid128OpenCluster", () => {
    it("is true for 3+ active MID 128 FMI 5 codes", () => {
      expect(
        detectFleetPatterns(
          on("MID128|PID153|FMI5", "MID128|PID107|FMI5", "MID128|PID173|FMI5")
        ).mid128OpenCluster
      ).toBe(true)
    })

    it("is false for 2 codes, other FMIs or INACTIVE rows", () => {
      expect(
        detectFleetPatterns(on("MID128|PID153|FMI5", "MID128|PID107|FMI5"))
          .mid128OpenCluster
      ).toBe(false)
      expect(
        detectFleetPatterns(
          on("MID128|PID153|FMI3", "MID128|PID107|FMI3", "MID128|PID173|FMI3")
        ).mid128OpenCluster
      ).toBe(false)
      expect(
        detectFleetPatterns([
          ...on("MID128|PID153|FMI5", "MID128|PID107|FMI5"),
          { canonicalKey: "MID128|PID173|FMI5", pttStatus: "INACTIVE" },
        ]).mid128OpenCluster
      ).toBe(false)
    })
  })

  describe("singleSideLightingFault", () => {
    it("is true when only one brake lamp (PSID 10 or 11) is faulting", () => {
      expect(
        detectFleetPatterns(on("MID216|PSID10|FMI5")).singleSideLightingFault
      ).toBe(true)
      expect(
        detectFleetPatterns(on("MID216|PSID11|FMI5")).singleSideLightingFault
      ).toBe(true)
    })

    it("is false when both brake lamps fault, or the opposite side is only inactive-clean", () => {
      expect(
        detectFleetPatterns(on("MID216|PSID10|FMI5", "MID216|PSID11|FMI5"))
          .singleSideLightingFault
      ).toBe(false)
      expect(detectFleetPatterns([]).singleSideLightingFault).toBe(false)
    })

    it("is true for a single high beam, false when both sides fault", () => {
      const one: PatternFault[] = [
        {
          canonicalKey: "MID216|PSID30|FMI5",
          pttStatus: "ACTIVE",
          description: "High beam, left - open circuit",
        },
      ]
      expect(detectFleetPatterns(one).singleSideLightingFault).toBe(true)

      const both: PatternFault[] = [
        ...one,
        {
          canonicalKey: "MID216|PSID31|FMI5",
          pttStatus: "ACTIVE",
          description: "High beam, right - open circuit",
        },
      ]
      expect(detectFleetPatterns(both).singleSideLightingFault).toBe(false)
    })
  })

  it("builds a payload with one mandate per TRUE flag", () => {
    const payload = buildFleetPatternPayload(
      detectFleetPatterns(on("MID144|PID84|FMI2", "MID128|PID84|FMI9"))
    )
    expect(payload.flags.roadSpeedPair).toBe(true)
    expect(payload.activeMandates.map((m) => m.flag)).toEqual(["roadSpeedPair"])
    expect(payload.activeMandates[0].mandate).toMatch(/tailshaft speed sensor/)
  })
})
