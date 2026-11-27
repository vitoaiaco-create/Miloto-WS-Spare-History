import { describe, expect, it } from "vitest"

import { buildCanonicalKey, type CanonicalKeyInput } from "./canonical-key"
import { FLEET_WIDE_EXCEPTION_SEEDS } from "./exception-seed-data"
import {
  buildBaselineCompletenessWarning,
  buildGateOverride,
  checkScanCompleteness,
} from "./gates"
import { PTT_INCOMPLETE_SCAN_OVERRIDE_PRESETS } from "./constants"
import { reconcileDiagnosticScans } from "./reconcile"
import {
  planReconcileExistingCase,
  type CaseSessionState,
  type PlanException,
  type ReconcileExistingInput,
  type StoredFaultRow,
} from "./reconcile-existing-plan"
import {
  baselineOnlyCase,
  closedCase,
  mtl41Case,
  FLEET_EXCEPTIONS,
} from "./report-fixtures"
import { buildScanFaultRecords } from "./scan-faults"
import { buildWorksTrackerData } from "./works-tracker-data"
import { buildWorksTrackerPdf } from "./works-tracker-pdf"

// Real-world fleet fixtures audited from the field (MTL41, MTL56, MTL63,
// MTL69, MTL113, MTL116, MTL126): hallucinated / cropped ECU labels and
// single-character OCR drift that must normalise to the true Volvo keys.

const NOW = new Date("2026-11-27T08:00:00Z")
const BASELINE_AT = new Date("2026-11-10T08:00:00Z")

function keyOf(input: CanonicalKeyInput): string | null {
  const built = buildCanonicalKey(input)
  return built.ok ? built.key : null
}

const v3 = (
  controlUnit: string,
  faultCode: string,
  description: string,
  extra: Partial<CanonicalKeyInput> = {}
) =>
  keyOf({
    controlUnit,
    faultCode,
    description,
    generation: "FH_V3",
    ...extra,
  })

// ---------------------------------------------------------------------------
// Plan helpers (stored rows, as they sit in ptt_scan_faults)
// ---------------------------------------------------------------------------

const alnum = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "")
let nextId = 1

function storedRow(
  ecuLabel: string,
  dtcRaw: string,
  description: string,
  canonicalKey: string = `UNVERIFIED|${alnum(ecuLabel)}|${alnum(dtcRaw)}`
): StoredFaultRow {
  return {
    id: nextId++,
    canonicalKey,
    ecuLabel,
    dtcRaw,
    description,
    pttStatus: "ACTIVE",
    severity: "CRITICAL",
    reconciliationBucket: null,
    isBounceBack: false,
    isApprovedException: false,
    isExtracted: true,
    keyNeedsReview: canonicalKey.startsWith("UNVERIFIED|"),
    keyReviewReason: null,
  }
}

const openSession: CaseSessionState = {
  caseStatus: "PARTIAL_BLOCKED",
  workflowStatus: "IN_PROGRESS",
  verifiedAt: null,
  closureMode: null,
  closureReasonCategory: null,
  closureNote: null,
  closedBy: null,
  closedAt: null,
}

function plan(
  fleetId: string,
  generation: "FH_V3" | "FH_V4",
  overrides: Partial<ReconcileExistingInput>
) {
  return planReconcileExistingCase({
    fleetId,
    generation,
    baselineScanId: 1,
    baselineScannedAt: BASELINE_AT,
    verificationScanId: 2,
    baselineRows: [],
    verificationRows: [],
    exceptions: [],
    ledger: new Map(),
    session: openSession,
    now: NOW,
    ...overrides,
  })
}

const seedExceptions = (keys?: readonly string[]): PlanException[] =>
  FLEET_WIDE_EXCEPTION_SEEDS.filter(
    (seed) => seed.generation === "FH_V3" && (!keys || keys.includes(seed.canonicalKey))
  ).map((seed) => ({
    scope: "FLEET_GENERATION",
    generation: seed.generation,
    fleetId: null,
    canonicalKey: seed.canonicalKey,
    isActive: true,
  }))

function keysByBucket(result: ReturnType<typeof plan>) {
  const byBucket = new Map<string, string[]>()
  for (const fault of result.result.faults) {
    const list = byBucket.get(fault.bucket) ?? []
    list.push(fault.canonicalKey)
    byBucket.set(fault.bucket, list)
  }
  return byBucket
}

// ---------------------------------------------------------------------------
// 1. MTL69
// ---------------------------------------------------------------------------

type Mtl69Row = {
  /** What the (hallucinating) vision pass wrote. */
  label: string
  code: string
  description: string
  /** The true key. */
  key: string
  /** What the baseline stored for the same fault (the correct label). */
  trueLabel: string
}

const MTL69_ROWS: readonly Mtl69Row[] = [
  {
    label: "Brake Lamp ECU",
    code: "PSID 10 FMI 5",
    description: "Brake lamp",
    key: "MID216|PSID10|FMI5",
    trueLabel: "Light Control Module (LCM) (MID 216)",
  },
  {
    label: "Fog Lamp ECU",
    code: "PSID 5 FMI 5",
    description: "Fog lamp, front",
    key: "MID216|PSID5|FMI5",
    trueLabel: "Light Control Module (LCM) (MID 216)",
  },
  {
    label: "Campaign Lights ECU",
    code: "PSID 67 FMI 5",
    description: "Campaign lights",
    key: "MID216|PSID67|FMI5",
    trueLabel: "Light Control Module (LCM) (MID 216)",
  },
  {
    label: "Reverse Lights ECU",
    code: "PSID 8 FMI 6",
    description: "Reverse lights",
    key: "MID216|PSID8|FMI6",
    trueLabel: "Light Control Module (LCM) (MID 216)",
  },
  {
    label: "Unknown ECU",
    code: "PSID 68 FMI 5",
    description: "null",
    key: "MID216|PSID68|FMI5",
    trueLabel: "Light Control Module (LCM) (MID 216)",
  },
  {
    label: "Compressor Control ECU",
    code: "PSID 24 FMI 4",
    description: "Compressor control",
    key: "MID144|PSID24|FMI4",
    trueLabel: "Vehicle ECU (MID 144)",
  },
  {
    label: "Regeneration Control ECU",
    code: "PSID 23 FMI 4",
    description: "Regeneration control",
    key: "MID144|PSID23|FMI4",
    trueLabel: "Vehicle ECU (MID 144)",
  },
  {
    label: "Rear Load Sensor ECU",
    code: "PSID 39 FMI 4",
    description: "Rear load sensor",
    key: "MID144|PSID39|FMI4",
    trueLabel: "Vehicle ECU (MID 144)",
  },
  {
    label: "FMS Gateway (MID 179)",
    code: "PSID 236 FMI 12",
    description: "Data Link, MID179",
    key: "MID140|PSID236|FMI12",
    trueLabel: "Instrument Cluster ECU (MID 140)",
  },
  {
    label: "Retarder ECU",
    code: "PPID 31 FMI 5",
    description: "Retarder temperature sensor",
    key: "MID222|PPID31|FMI5",
    trueLabel: "Retarder ECU (MID 222)",
  },
  {
    // "(MID 128)" cropped off the photo: really the Retarder's PID 110.
    label: "Engine ECU",
    code: "PID 110 FMI 5",
    description: "Coolant temperature",
    key: "MID222|PID110|FMI5",
    trueLabel: "Retarder ECU (MID 222)",
  },
]

const MTL69_KEYS = MTL69_ROWS.map((row) => row.key).sort()
const MTL69_EXCEPTION_KEYS = [
  "MID144|PSID23|FMI4",
  "MID144|PSID24|FMI4",
  "MID144|PSID39|FMI4",
  "MID140|PSID236|FMI12",
].sort()

describe("MTL69: hallucinated / cropped ECU labels (FH V3)", () => {
  it("rescues every label to its true MID in a live scan", () => {
    const records = buildScanFaultRecords(
      MTL69_ROWS.map((row) => ({
        controlUnit: row.label,
        faultCode: row.code,
        description: row.description,
        faultState: "ACTIVE" as const,
        severity: "CRITICAL" as const,
      })),
      "FH_V3"
    )
    expect(records.map((record) => record.canonicalKey).sort()).toEqual(MTL69_KEYS)
    expect(records.every((record) => !record.keyNeedsReview)).toBe(true)
  })

  it.each([
    ["Brake Lamp ECU", "PSID 10 FMI 5", "Brake lamp", "MID216|PSID10|FMI5"],
    ["", "PSID 15 FMI 2", "Parking light, left", "MID216|PSID15|FMI2"],
    ["Light ECU", "PSID 42 FMI 3", "Dimmer, background lighting", "MID216|PSID42|FMI3"],
    ["Unknown ECU", "PSID 68 FMI 3", "Circuit open", "MID216|PSID68|FMI3"],
    ["", "PSID 23 FMI 4", "Regeneration control", "MID144|PSID23|FMI4"],
    ["Retarder ECU", "SID 2 FMI 3", "Retarder control", "MID222|SID2|FMI3"],
  ])("%j %s (%s) -> %s", (label, code, description, expected) => {
    expect(v3(label, code, description)).toBe(expected)
  })

  it("rescues PSID 236 reported by MID 179 to MID140 (keeps the FMI)", () => {
    expect(v3("Gateway (MID 179)", "PSID 236 FMI 12", "")).toBe("MID140|PSID236|FMI12")
    expect(
      v3("Gateway (MID 179)", "PSID 236 FMI 9", "Faulty device or component")
    ).toBe("MID140|PSID236|FMI9")
    // No FMI 12 and no matching description: left alone.
    expect(v3("Gateway (MID 179)", "PSID 236 FMI 9", "Something else")).toBe(
      "MID179|PSID236|FMI9"
    )
  })

  it("never rescues a lamp ECU without a lighting description or the right code", () => {
    // Right label, but the description is not a lighting fault.
    expect(v3("Brake Lamp ECU", "PSID 10 FMI 5", "Parking brake switch")).toBeNull()
    // Lighting description, but PSID 24 is not a lighting code.
    expect(v3("Brake Lamp ECU", "PSID 24 FMI 5", "Brake lamp")).toBeNull()
    // Not an FH V3 truck: no rescue at all.
    expect(
      keyOf({
        controlUnit: "Brake Lamp ECU",
        faultCode: "PSID 10 FMI 5",
        description: "Brake lamp",
      })
    ).toBeNull()
    expect(
      keyOf({
        controlUnit: "Brake Lamp ECU",
        faultCode: "PSID 10 FMI 5",
        description: "Brake lamp",
        generation: "FH_V4",
      })
    ).toBeNull()
  })

  describe("scan-level MID222 PID110 context rescue", () => {
    const retarder = {
      controlUnit: "Retarder ECU (MID 222)",
      faultCode: "PPID 31 FMI 5",
      description: "Retarder temperature",
      faultState: "ACTIVE" as const,
      severity: "CRITICAL" as const,
    }
    const bareEngine = {
      controlUnit: "Engine ECU",
      faultCode: "PID 110 FMI 5",
      description: "Coolant temperature",
      faultState: "ACTIVE" as const,
      severity: "CRITICAL" as const,
    }

    it("remaps a bare Engine ECU PID 110 FMI 5 when the scan has another Retarder fault", () => {
      const keys = buildScanFaultRecords([retarder, bareEngine], "FH_V3").map(
        (record) => record.canonicalKey
      )
      expect(keys).toContain("MID222|PID110|FMI5")
      expect(keys).toContain("MID222|PPID31|FMI5")
    })

    it("leaves it unverified when the scan has no other Retarder fault", () => {
      const [record] = buildScanFaultRecords([bareEngine], "FH_V3")
      expect(record.canonicalKey.startsWith("UNVERIFIED|")).toBe(true)
    })

    it("never remaps a row with an explicit (MID 128): genuine engine coolant stays", () => {
      const keys = buildScanFaultRecords(
        [
          retarder,
          { ...bareEngine, controlUnit: "Engine ECU (MID 128)" },
        ],
        "FH_V3"
      ).map((record) => record.canonicalKey)
      expect(keys).toContain("MID128|PID110|FMI5")
      expect(keys).not.toContain("MID222|PID110|FMI5")
    })

    it("only applies to PID 110 FMI 5", () => {
      const [, other] = buildScanFaultRecords(
        [retarder, { ...bareEngine, faultCode: "PID 110 FMI 3" }],
        "FH_V3"
      )
      expect(other.canonicalKey.startsWith("UNVERIFIED|")).toBe(true)
    })
  })

  describe.each([
    ["a correctly keyed baseline", false],
    ["a legacy baseline that hallucinated the same labels", true],
  ])("reconcileExistingCase planner with %s", (_name, hallucinatedBaseline) => {
    const baselineRows = MTL69_ROWS.map((row) =>
      hallucinatedBaseline
        ? storedRow(row.label, row.code, row.description)
        : storedRow(row.trueLabel, row.code, row.description, row.key)
    )
    const verificationRows = MTL69_ROWS.map((row) =>
      storedRow(row.label, row.code, row.description)
    )
    const result = plan("MTL69", "FH_V3", {
      baselineRows,
      verificationRows,
      exceptions: seedExceptions(MTL69_EXCEPTION_KEYS),
    })
    const buckets = keysByBucket(result)

    it("keys all 11 verification rows to the true MID", () => {
      const keys = result.verification.updates.map(
        (update) => update.values.canonicalKey
      )
      expect(keys.sort()).toEqual(MTL69_KEYS)
      expect(keys.some((key) => key.startsWith("UNVERIFIED|"))).toBe(false)
    })

    it("matches before and after: nothing is both Cleared and Residual", () => {
      const cleared = new Set(buckets.get("CLEARED") ?? [])
      const residual = [
        ...(buckets.get("PERSISTING_OPEN") ?? []),
        ...(buckets.get("PERSISTING_EXCEPTION") ?? []),
        ...(buckets.get("NEW_REGRESSION") ?? []),
      ]
      expect(cleared.size).toBe(0)
      expect(residual.filter((key) => cleared.has(key))).toEqual([])
      expect(buckets.get("NEW_REGRESSION") ?? []).toEqual([])
      expect([...residual].sort()).toEqual(MTL69_KEYS)
      expect(result.result.summary.clearedCount).toBe(0)
    })

    it("matches the 4 approved exceptions", () => {
      const exceptions = result.result.faults.filter(
        (fault) => fault.isApprovedException
      )
      expect(exceptions.map((fault) => fault.canonicalKey).sort()).toEqual(
        MTL69_EXCEPTION_KEYS
      )
      expect(
        exceptions.every((fault) => fault.bucket === "PERSISTING_EXCEPTION")
      ).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// 2. MTL41
// ---------------------------------------------------------------------------

describe("MTL41: legacy code / prefix drift (FH V3)", () => {
  it.each([
    ["Vehicle ECU (MID 144)", "PSID 223 FMI 4", "Regeneration control", "MID144|PSID23|FMI4"],
    ["Vehicle ECU (MID 144)", "PSID 232 FMI 4", "Regeneration control", "MID144|PSID23|FMI4"],
    ["Vehicle ECU (MID 144)", "PSID 230 FMI 4", "Rear load sensor", "MID144|PSID39|FMI4"],
    ["Vehicle ECU (MID 144)", "PID 3 FMI 4", "Starter Output", "MID144|PPID3|FMI4"],
  ])("%s %s (%s) -> %s", (unit, code, description, expected) => {
    expect(v3(unit, code, description)).toBe(expected)
  })

  it("keeps a genuine PID 3 / PSID 223 on other descriptions untouched", () => {
    expect(v3("Vehicle ECU (MID 144)", "PID 3 FMI 4", "Something else")).toBe(
      "MID144|PID3|FMI4"
    )
    expect(
      v3("Vehicle ECU (MID 144)", "PSID 223 FMI 4", "Something else")
    ).toBe("MID144|PSID223|FMI4")
  })

  it("matches the baseline instead of splitting into Cleared + Residual", () => {
    const baselineRows = [
      storedRow("Vehicle ECU (MID 144)", "PSID 223 FMI 4", "Regeneration control"),
      storedRow("Vehicle ECU (MID 144)", "PSID 230 FMI 4", "Rear load sensor"),
      storedRow("Vehicle ECU (MID 144)", "PPID 3 FMI 4", "Starter Output", "MID144|PPID3|FMI4"),
    ]
    // After the repair the baseline's legacy (wrongly keyed) rows persist, and
    // the after-scan read the starter circuit as PID 3.
    const verificationRows = [
      storedRow("Vehicle ECU (MID 144)", "PSID 23 FMI 4", "Regeneration control", "MID144|PSID23|FMI4"),
      storedRow("Vehicle ECU (MID 144)", "PSID 39 FMI 4", "Rear load sensor", "MID144|PSID39|FMI4"),
      storedRow("Vehicle ECU (MID 144)", "PID 3 FMI 4", "Starter Output", "MID144|PID3|FMI4"),
    ]
    const result = plan("MTL41", "FH_V3", {
      baselineRows,
      verificationRows,
      exceptions: seedExceptions(),
    })
    const buckets = keysByBucket(result)
    expect(buckets.get("CLEARED") ?? []).toEqual([])
    expect(buckets.get("NEW_REGRESSION") ?? []).toEqual([])
    const persisting = [
      ...(buckets.get("PERSISTING_OPEN") ?? []),
      ...(buckets.get("PERSISTING_EXCEPTION") ?? []),
    ].sort()
    expect(persisting).toEqual([
      "MID144|PPID3|FMI4",
      "MID144|PSID23|FMI4",
      "MID144|PSID39|FMI4",
    ])
    // The baseline's legacy rows were re-keyed in place.
    expect(
      result.baseline.updates.map((update) => update.values.canonicalKey).sort()
    ).toEqual(["MID144|PSID23|FMI4", "MID144|PSID39|FMI4"])
    expect(result.repairedKeysCount).toBeGreaterThanOrEqual(3)
  })
})

// ---------------------------------------------------------------------------
// 3. MTL63 & MTL56
// ---------------------------------------------------------------------------

describe("MTL63 / MTL56: code, prefix and ECU drift (FH V3)", () => {
  it.each([
    [
      "MID130|PSID37 -> MID130|PID37",
      "Gearbox ECU (MID 130)",
      "PSID 37 FMI 1",
      "Transmission tank air pressure",
      "MID130|PID37|FMI1",
    ],
    [
      "MID206 PSID1 -> PSID11",
      "Radio (MID 206)",
      "PSID 1 FMI 2",
      "Audio microphone",
      "MID206|PSID11|FMI2",
    ],
    [
      "MID206 PSID2 -> PSID12",
      "Radio (MID 206)",
      "PSID 2 FMI 3",
      "Audio output left front",
      "MID206|PSID12|FMI3",
    ],
    [
      "MID206 PSID4 -> PSID14",
      "Radio (MID 206)",
      "PSID 4 FMI 4",
      "Audio output left rear",
      "MID206|PSID14|FMI4",
    ],
    [
      "MID206 PSID5 -> PSID15",
      "Radio (MID 206)",
      "PSID 5 FMI 5",
      "Audio output right rear",
      "MID206|PSID15|FMI5",
    ],
    [
      "MID140 PSID10 CD -> MID206",
      "Instrument Cluster ECU (MID 140)",
      "PSID 10 FMI 2",
      "CD, FMI 2",
      "MID206|PSID10|FMI2",
    ],
    [
      "MID144 PSID10 CD -> MID206",
      "Vehicle ECU (MID 144)",
      "PSID 10 FMI 7",
      "CD, data erratic",
      "MID206|PSID10|FMI7",
    ],
    [
      "unverified ECU PSID10 CD -> MID206",
      "",
      "PSID 10 FMI 7",
      "CD, data erratic",
      "MID206|PSID10|FMI7",
    ],
    [
      "MID130 PSID171 FMI5 -> MID140|PID171",
      "Gearbox ECU (MID 130)",
      "PSID 171 FMI 5",
      "Ambient air temperature",
      "MID140|PID171|FMI5",
    ],
    [
      "MID130 PID171 FMI5 -> MID140|PID171",
      "Gearbox ECU (MID 130)",
      "PID 171 FMI 5",
      "Ambient air temperature",
      "MID140|PID171|FMI5",
    ],
    [
      "MID144 SID11 -> MID146|SID11",
      "Vehicle ECU (MID 144)",
      "SID 11 FMI 5",
      "Magnetic clutch, compressor",
      "MID146|SID11|FMI5",
    ],
    [
      "MID140 RID116 -> MID140|PID118",
      "Instrument Cluster ECU (MID 140)",
      "RID 116 FMI 4",
      "Brake secondary pressure",
      "MID140|PID118|FMI4",
    ],
    [
      "MID140 PID116 -> MID140|PID118",
      "Instrument Cluster ECU (MID 140)",
      "PID 116 FMI 4",
      "Brake secondary pressure",
      "MID140|PID118|FMI4",
    ],
  ])("%s", (_name, unit, code, description, expected) => {
    expect(v3(unit, code, description)).toBe(expected)
  })

  it("is description-guarded: the same code on another description is untouched", () => {
    expect(v3("Gearbox ECU (MID 130)", "PSID 37 FMI 1", "Gearbox oil")).toBe(
      "MID130|PSID37|FMI1"
    )
    expect(v3("Radio (MID 206)", "PSID 1 FMI 2", "Something else")).toBe(
      "MID206|PSID1|FMI2"
    )
    // "CD" must be a standalone word.
    expect(v3("Vehicle ECU (MID 144)", "PSID 10 FMI 2", "ABCD circuit")).toBe(
      "MID144|PSID10|FMI2"
    )
    // Only FMI 5 on the ambient air temperature rescue.
    expect(
      v3("Gearbox ECU (MID 130)", "PSID 171 FMI 3", "Ambient air temperature")
    ).toBe("MID130|PSID171|FMI3")
    // No description at all: nothing fires.
    expect(v3("Vehicle ECU (MID 144)", "SID 11 FMI 5", "")).toBe(
      "MID144|SID11|FMI5"
    )
  })

  it("only fires on FH V3 trucks", () => {
    const input = {
      controlUnit: "Vehicle ECU (MID 144)",
      faultCode: "SID 11 FMI 5",
      description: "Magnetic clutch, compressor",
    }
    expect(keyOf({ ...input, generation: "UNKNOWN" })).toBe("MID144|SID11|FMI5")
    expect(keyOf(input)).toBe("MID144|SID11|FMI5")
    expect(keyOf({ ...input, generation: "FH_V3" })).toBe("MID146|SID11|FMI5")
  })

  it("a bare RID code is never accepted without its rescue", () => {
    expect(v3("Instrument Cluster ECU (MID 140)", "RID 116 FMI 4", "Other")).toBeNull()
  })

  it("repairs a stored MTL56 / MTL63 case end to end", () => {
    const baselineRows = [
      storedRow("Vehicle ECU (MID 144)", "SID 11 FMI 5", "Magnetic clutch, compressor"),
      storedRow("Instrument Cluster ECU (MID 140)", "PSID 10 FMI 2", "CD, FMI 2"),
    ]
    const verificationRows = [
      storedRow("Vehicle ECU (MID 144)", "SID 11 FMI 5", "Magnetic clutch, compressor"),
      storedRow("Radio (MID 206)", "PSID 10 FMI 2", "CD, FMI 2", "MID206|PSID10|FMI2"),
    ]
    const result = plan("MTL56", "FH_V3", {
      baselineRows,
      verificationRows,
      exceptions: seedExceptions(),
    })
    const buckets = keysByBucket(result)
    expect(buckets.get("CLEARED") ?? []).toEqual([])
    expect(buckets.get("NEW_REGRESSION") ?? []).toEqual([])
    expect(
      [
        ...(buckets.get("PERSISTING_OPEN") ?? []),
        ...(buckets.get("PERSISTING_EXCEPTION") ?? []),
      ].sort()
    ).toEqual(["MID146|SID11|FMI5", "MID206|PSID10|FMI2"])
  })
})

// ---------------------------------------------------------------------------
// 4. MTL113 & MTL116 (FH V4)
// ---------------------------------------------------------------------------

describe("MTL113 / MTL116: FH V4 single-character hex drift", () => {
  const v4 = (
    controlUnit: string,
    faultCode: string,
    description: string,
    generation: CanonicalKeyInput["generation"] = "FH_V4"
  ) => keyOf({ controlUnit, faultCode, description, generation })

  it("CCIOM U114B87 (LIN11) -> CCIOM|U114187", () => {
    expect(v4("CCIOM", "U114B87", "LIN11 communication fault")).toBe(
      "CCIOM|U114187"
    )
    expect(v4("Center Chassis I/O Module (CCIOM)", "U114B87", "LIN 11")).toBe(
      "CCIOM|U114187"
    )
  })

  it("HMIIOM U115109 (Lane Position Object) -> HMIIOM|U115100", () => {
    expect(
      v4("HMI I/O Module (HMIIOM)", "U115109", "Lane Position Object")
    ).toBe("HMIIOM|U115100")
  })

  it("is description- and generation-guarded", () => {
    expect(v4("CCIOM", "U114B87", "Something else")).toBe("CCIOM|U114B87")
    expect(v4("CCIOM", "U114B87", "")).toBe("CCIOM|U114B87")
    expect(
      keyOf({
        controlUnit: "HMIIOM",
        faultCode: "U115109",
        description: "Lane Position Object",
      })
    ).toBe("HMIIOM|U115109")
    expect(v4("HMIIOM", "U115109", "Lane Position Object", "UNKNOWN")).toBe(
      "HMIIOM|U115109"
    )
    // The correct codes are never touched.
    expect(v4("CCIOM", "U114187", "LIN11")).toBe("CCIOM|U114187")
  })

  it("matches before and after on a stored MTL113 / MTL116 case", () => {
    const baselineRows = [
      storedRow("CCIOM", "U114B87", "LIN11 communication"),
      storedRow("HMIIOM", "U115109", "Lane Position Object"),
    ]
    const verificationRows = [
      storedRow("CCIOM", "U114187", "LIN11 communication", "CCIOM|U114187"),
      storedRow("HMIIOM", "U115100", "Lane Position Object", "HMIIOM|U115100"),
    ]
    const result = plan("MTL113", "FH_V4", { baselineRows, verificationRows })
    const buckets = keysByBucket(result)
    expect(buckets.get("CLEARED") ?? []).toEqual([])
    expect(buckets.get("NEW_REGRESSION") ?? []).toEqual([])
    expect(
      [
        ...(buckets.get("PERSISTING_OPEN") ?? []),
        ...(buckets.get("PERSISTING_EXCEPTION") ?? []),
      ].sort()
    ).toEqual(["CCIOM|U114187", "HMIIOM|U115100"])
  })
})

// ---------------------------------------------------------------------------
// 5. MTL126: incomplete-scan scroll hint
// ---------------------------------------------------------------------------

describe("MTL126: incomplete-scan scroll diagnostics", () => {
  const HIDDEN = "Magnetic clutch, compressor"
  const extractedDescriptions = Array.from(
    { length: 11 },
    (_, index) => `Fault description ${index + 1}`
  )

  it("tells the user the top of the PTT list was scrolled past", () => {
    const check = checkScanCompleteness(14, 11, {
      selectedFooterText: HIDDEN,
      rowDescriptions: extractedDescriptions,
    })
    expect(check.isComplete).toBe(false)
    expect(check.missingCount).toBe(3)
    expect(check.hiddenFooterText).toBe(HIDDEN)
    expect(check.message).toBe(
      `INCOMPLETE_SCAN: Captured 11 of 14 faults — the top of the PTT list appears scrolled past ("${HIDDEN}" is hidden above row 1). Scroll to the top of PTT and upload the missing page(s), or tick Override below to proceed.`
    )
    expect(check.message).toContain(`"${HIDDEN}"`)
    expect(check.message).toContain("hidden above row 1")
  })

  it("keeps the gate active but uses the standard message otherwise", () => {
    const standard =
      "INCOMPLETE_SCAN: Captured 11 of 14 faults — upload the missing scroll page(s)"
    // Footer row IS among the extracted rows (a middle page is missing).
    const matched = checkScanCompleteness(14, 11, {
      selectedFooterText: "fault description 4",
      rowDescriptions: extractedDescriptions,
    })
    expect(matched.isComplete).toBe(false)
    expect(matched.message).toBe(standard)
    expect(matched.hiddenFooterText).toBeNull()
    // Unreadable / empty footer, or no evidence at all.
    for (const evidence of [
      { selectedFooterText: null, rowDescriptions: extractedDescriptions },
      { selectedFooterText: "   ", rowDescriptions: extractedDescriptions },
      undefined,
    ]) {
      const check = checkScanCompleteness(14, 11, evidence)
      expect(check.isComplete).toBe(false)
      expect(check.message).toBe(standard)
    }
  })

  it("never weakens the gate: a complete scan stays complete, a short one blocks", () => {
    expect(checkScanCompleteness(14, 14).isComplete).toBe(true)
    expect(checkScanCompleteness(null, 3).isComplete).toBe(true)
    expect(
      checkScanCompleteness(14, 13, {
        selectedFooterText: HIDDEN,
        rowDescriptions: extractedDescriptions,
      }).isComplete
    ).toBe(false)
  })

  it("overriding with a reason lets the reconciliation succeed", () => {
    const check = checkScanCompleteness(14, 11, {
      selectedFooterText: HIDDEN,
      rowDescriptions: extractedDescriptions,
    })
    expect(check.isComplete).toBe(false)

    // No reason: no override, the route throws INCOMPLETE_SCAN.
    expect(buildGateOverride("INCOMPLETE_SCAN", "   ", "user_1", NOW)).toBeNull()

    // Every one-tap preset is a valid override reason.
    for (const reason of PTT_INCOMPLETE_SCAN_OVERRIDE_PRESETS) {
      expect(reason.length).toBeGreaterThanOrEqual(10)
      expect(buildGateOverride("INCOMPLETE_SCAN", reason, "user_1", NOW)).toMatchObject({
        gate: "INCOMPLETE_SCAN",
        reason,
        by: "user_1",
      })
    }
    const override = buildGateOverride(
      "INCOMPLETE_SCAN",
      PTT_INCOMPLETE_SCAN_OVERRIDE_PRESETS[0],
      "user_1",
      NOW
    )
    expect(override).not.toBeNull()

    // ...and the reconciliation proceeds on the rows that were captured.
    const result = reconcileDiagnosticScans({
      fleetId: "MTL126",
      generation: "FH_V3",
      baselineFaults: [
        { canonicalKey: "MID128|PID94|FMI5", pttStatus: "ACTIVE", severity: "CRITICAL" },
        { canonicalKey: "MID146|SID11|FMI5", pttStatus: "ACTIVE", severity: "MONITOR" },
      ],
      verificationFaults: [
        { canonicalKey: "MID128|PID94|FMI5", pttStatus: "INACTIVE", severity: "CRITICAL" },
      ],
      exceptions: [],
    })
    expect(result.caseStatus).toBeDefined()
    expect(result.summary.clearedCount).toBeGreaterThanOrEqual(1)
  })

  it("exposes the three one-tap override reasons verbatim", () => {
    expect([...PTT_INCOMPLETE_SCAN_OVERRIDE_PRESETS]).toEqual([
      "Top/bottom rows scrolled off photo; truck already dispatched",
      "Hidden rows are non-critical / approved exceptions",
      "PTT screen could not scroll further",
    ])
  })
})

describe("non-blocking baseline completeness warning", () => {
  const rows = Array.from({ length: 16 }, (_, index) => `Row ${index + 1}`)

  it("names the rows scrolled off the top", () => {
    expect(
      buildBaselineCompletenessWarning(18, 16, {
        selectedFooterText: "Magnetic clutch, compressor",
        rowDescriptions: rows,
      })
    ).toBe(
      "Baseline photo captured 16 of 18 items — 2 rows (including 'Magnetic clutch, compressor') appear scrolled off the top"
    )
  })

  it("falls back to a generic note without footer evidence", () => {
    expect(buildBaselineCompletenessWarning(18, 17)).toBe(
      "Baseline photo captured 17 of 18 items — 1 row appears to be missing (scroll page not captured)"
    )
  })

  it("is null when the scan is complete or the header was unreadable", () => {
    expect(buildBaselineCompletenessWarning(16, 16)).toBeNull()
    expect(buildBaselineCompletenessWarning(null, 5)).toBeNull()
    expect(buildBaselineCompletenessWarning(14, 15)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. Works Tracker PDF note formatting
// ---------------------------------------------------------------------------

describe("Works Tracker PDF: Note formatting", () => {
  const input = {
    sessions: [
      mtl41Case({
        status: "VERIFIED_CLOSED",
        caseStatus: "CLOSED_ACCEPTED_RESIDUALS",
        closureReasonCategory: "HARDWARE_CONVERSION",
        closureNote: "Residuals to be analysed",
        closedAt: new Date(2026, 10, 25, 10, 0),
      }),
      baselineOnlyCase(["MID128|PID94|FMI5"]),
      closedCase(["MID128|PID94|FMI5"]),
    ],
    ledger: [],
    exceptions: FLEET_EXCEPTIONS,
    roster: [
      { fleetId: "MTL41", generation: "FH_V3" as const },
      { fleetId: "MTL07", generation: "FH_V3" as const },
      { fleetId: "MTL02", generation: "FH_V3" as const },
    ],
  }
  const data = buildWorksTrackerData(input, undefined, new Date(2026, 10, 26, 12, 0))
  const source = Buffer.from(buildWorksTrackerPdf(data).buffer).toString("latin1")

  it("joins the reason label and the note once, with an ASCII hyphen", () => {
    const row = data.rows.find((candidate) => candidate.fleetId === "MTL41")
    expect(row?.closureNote).toBe("Hardware conversion - Residuals to be analysed")
  })

  it("prints one clean Note line and never the duplicated prefix", () => {
    expect(source).toContain("Note: Hardware conversion - Residuals to be analysed")
    expect(source).not.toContain("Note: Closure:")
    expect(source).not.toContain("Closure: Hardware conversion")
  })

  it("prints just the reason when the manager added no extra note", () => {
    const bare = buildWorksTrackerData(
      {
        ...input,
        sessions: [
          mtl41Case({
            status: "VERIFIED_CLOSED",
            caseStatus: "CLOSED_ACCEPTED_RESIDUALS",
            closureReasonCategory: "HARDWARE_CONVERSION",
            closureNote: null,
            closedAt: new Date(2026, 10, 25, 10, 0),
          }),
        ],
      },
      undefined,
      new Date(2026, 10, 26, 12, 0)
    )
    expect(bare.rows.find((row) => row.fleetId === "MTL41")?.closureNote).toBe(
      "Hardware conversion"
    )
    const bareSource = Buffer.from(buildWorksTrackerPdf(bare).buffer).toString("latin1")
    expect(bareSource).toContain("Note: Hardware conversion)")
  })
})
