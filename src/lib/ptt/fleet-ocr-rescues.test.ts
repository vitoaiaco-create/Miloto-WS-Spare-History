import { describe, expect, it } from "vitest"

import {
  buildCanonicalKey,
  normalizeEcuAcronym,
  sanitizeFaultCode,
  type CanonicalKeyInput,
} from "./canonical-key"
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
import { formatCodeLabel } from "./report-data"
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

// ---------------------------------------------------------------------------
// 7. Colon-in-code stripping
// ---------------------------------------------------------------------------

const exceptionsFor = (
  generation: "FH_V3" | "FH_V4",
  keys: readonly string[]
): PlanException[] =>
  FLEET_WIDE_EXCEPTION_SEEDS.filter(
    (seed) => seed.generation === generation && keys.includes(seed.canonicalKey)
  ).map((seed) => ({
    scope: "FLEET_GENERATION",
    generation: seed.generation,
    fleetId: null,
    canonicalKey: seed.canonicalKey,
    isActive: true,
  }))

describe("colon-in-code stripping", () => {
  const CCIOM_CODE =
    "C103715: Chassis Lubrication Motor, Circuit Short To Battery or Open"
  const PSID214_CODE = "PSID 214: Data link, MID249, FMI 9: Abnormal update rate"
  const PSID236_CODE =
    "PSID 236: Data Link, MID179, FMI 12: Faulty device or component"

  it("FH V4 CCIOIM + C103715 with the description in the code -> CCIOM|C103715", () => {
    expect(
      keyOf({
        controlUnit: "Center Chassis I/O Module (CCIOIM)",
        faultCode: CCIOM_CODE,
        description: "Chassis Lubrication Motor",
        generation: "FH_V4",
      })
    ).toBe("CCIOM|C103715")
  })

  it("FH V3 Vehicle ECU PSID 214 (empty FMI) recovers FMI 9 from the code text", () => {
    expect(v3("Vehicle ECU (MID 144)", PSID214_CODE, "")).toBe("MID144|PSID214|FMI9")
    expect(v3("Vehicle ECU (MID 144)", PSID214_CODE, "Data link")).toBe(
      "MID144|PSID214|FMI9"
    )
  })

  it("recovers the FMI from the description when the code has none", () => {
    expect(
      v3("Information display (MID 140)", "PSID 214:", "Data link, MID249, FMI 12: Faulty")
    ).toBe("MID140|PSID214|FMI12")
  })

  it("FH V3 Information display PSID 236 -> MID140|PSID236|FMI12", () => {
    expect(v3("Information display (MID 140)", PSID236_CODE, "")).toBe(
      "MID140|PSID236|FMI12"
    )
  })

  it("keeps an FMI printed on the left-hand side and ignores the rest", () => {
    expect(
      v3("Engine ECU (MID 128)", "PID 175 FMI 5: Engine oil temperature, FMI 3: x", "")
    ).toBe("MID128|PID175|FMI5")
    // "PID: 175" keeps its colon (nothing to split).
    expect(v3("Engine ECU (MID 128)", "PID: 175 FMI 5", "")).toBe("MID128|PID175|FMI5")
  })

  it("trims trailing punctuation and extracts a V4 DTC from a concatenated label", () => {
    expect(
      keyOf({
        controlUnit: "Air Production Module (APM)",
        faultCode: "U002886;. ",
        generation: "FH_V4",
      })
    ).toBe("APM|U002886")
    expect(
      keyOf({
        controlUnit: "Center Chassis I/O Module (CCIOIM)",
        faultCode: "Center Chassis I/O Module (CCIOIM) C103715",
        generation: "FH_V4",
      })
    ).toBe("CCIOM|C103715")
  })

  it("sanitizeFaultCode is idempotent", () => {
    const once = sanitizeFaultCode(PSID214_CODE, { generation: "FH_V3" })
    expect(once).toBe("PSID 214 FMI 9")
    expect(sanitizeFaultCode(once, { generation: "FH_V3" })).toBe(once)
    expect(sanitizeFaultCode(CCIOM_CODE)).toBe("C103715")
  })

  it("stored colon rows are re-keyed and match the approved exceptions (V4 + V3)", () => {
    const v4Row = storedRow(
      "Center Chassis I/O Module (CCIOIM)",
      CCIOM_CODE,
      "Chassis Lubrication Motor, Circuit Short To Battery or Open"
    )
    const v4Result = plan("MTL22", "FH_V4", {
      baselineRows: [v4Row],
      verificationRows: [{ ...v4Row, id: nextId++ }],
      exceptions: exceptionsFor("FH_V4", ["CCIOM|C103715"]),
    })
    const v4Faults = v4Result.result.faults
    expect(v4Faults.map((fault) => fault.canonicalKey)).toEqual(["CCIOM|C103715"])
    expect(v4Faults.every((fault) => fault.isApprovedException)).toBe(true)

    const v3Row = storedRow("Vehicle ECU (MID 144)", PSID214_CODE, "")
    const v3Result = plan("MTL10", "FH_V3", {
      baselineRows: [v3Row],
      verificationRows: [{ ...v3Row, id: nextId++ }],
      exceptions: exceptionsFor("FH_V3", ["MID144|PSID214|FMI9"]),
    })
    const v3Faults = v3Result.result.faults
    expect(v3Faults.map((fault) => fault.canonicalKey)).toEqual([
      "MID144|PSID214|FMI9",
    ])
    expect(v3Faults.every((fault) => fault.isApprovedException)).toBe(true)
    expect(v3Result.result.summary.clearedCount).toBe(0)
  })

  it("an unreadable colon code displays only the bare code, not the description", () => {
    expect(
      formatCodeLabel(
        "UNVERIFIED|MYSTERYBOX|C103715",
        "Mystery Box",
        "C103715: Chassis Lubrication Motor, Circuit Short To Battery or Open"
      )
    ).toBe("Mystery Box C103715")
  })
})

// ---------------------------------------------------------------------------
// 8. MTL69 legacy rows: FMI-only description, component name in the ECU label
// ---------------------------------------------------------------------------

describe("MTL69 FMI-only description fixture", () => {
  const FMI_ONLY = "Current below normal or open circuit"

  it.each([
    ["Brake Lamp ECU", "PSID 10 FMI 5", "MID216|PSID10|FMI5"],
    ["Fog Lamp ECU", "PSID 5 FMI 5", "MID216|PSID5|FMI5"],
    ["Campaign Lights ECU", "PSID 67 FMI 5", "MID216|PSID67|FMI5"],
    ["Reverse Lights ECU", "PSID 8 FMI 6", "MID216|PSID8|FMI6"],
    ["Regeneration Control ECU", "PSID 23 FMI 4", "MID144|PSID23|FMI4"],
    ["Compressor Control ECU", "PSID 24 FMI 4", "MID144|PSID24|FMI4"],
    ["Rear Load Sensor ECU", "PSID 39 FMI 4", "MID144|PSID39|FMI4"],
  ])("%s %s with an FMI-only description -> %s", (label, code, expected) => {
    expect(v3(label, code, FMI_ONLY)).toBe(expected)
    expect(v3(label, code, "")).toBe(expected)
  })

  it("resolves all 7 rows in a live scan and keeps them out of review", () => {
    const rows = [
      ["Brake Lamp ECU", "PSID 10 FMI 5"],
      ["Fog Lamp ECU", "PSID 5 FMI 5"],
      ["Campaign Lights ECU", "PSID 67 FMI 5"],
      ["Reverse Lights ECU", "PSID 8 FMI 6"],
      ["Compressor Control ECU", "PSID 24 FMI 4"],
      ["Regeneration Control ECU", "PSID 23 FMI 4"],
      ["Rear Load Sensor ECU", "PSID 39 FMI 4"],
    ] as const
    const records = buildScanFaultRecords(
      rows.map(([controlUnit, faultCode]) => ({
        controlUnit,
        faultCode,
        description: FMI_ONLY,
        faultState: "ACTIVE" as const,
        severity: "CRITICAL" as const,
      })),
      "FH_V3"
    )
    expect(records.map((record) => record.canonicalKey).sort()).toEqual([
      "MID144|PSID23|FMI4",
      "MID144|PSID24|FMI4",
      "MID144|PSID39|FMI4",
      "MID216|PSID10|FMI5",
      "MID216|PSID5|FMI5",
      "MID216|PSID67|FMI5",
      "MID216|PSID8|FMI6",
    ])
    expect(records.every((record) => !record.keyNeedsReview)).toBe(true)
  })

  it("a description that names a different component still blocks the rescue", () => {
    expect(v3("Brake Lamp ECU", "PSID 10 FMI 5", "Parking brake switch")).toBeNull()
    expect(v3("Regeneration Control ECU", "PSID 23 FMI 4", "Parking light")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 9. MTL126 / MTL73 / MTL23 / MTL36 (FH V3) and MTL22 (FH V4)
// ---------------------------------------------------------------------------

describe("MTL126 / MTL73 / MTL23 / MTL36: remaining FH V3 rescues", () => {
  it.each([
    ["MID216 PID84 road speed", "Light Control Module (LCM) (MID 216)", "PID 84 FMI 2", "Road speed", "MID144|PID84|FMI2"],
    ["MID216 PSID23 regeneration control", "Light Control Module (LCM) (MID 216)", "PSID 23 FMI 4", "Regeneration control", "MID144|PSID23|FMI4"],
    ["MID216 PSID39 rear load sensor", "Light Control Module (LCM) (MID 216)", "PSID 39 FMI 4", "Rear load sensor", "MID144|PSID39|FMI4"],
    ["MID140 PID177 ambient air temperature", "Instrument Cluster ECU (MID 140)", "PID 177 FMI 3", "Ambient air temperature", "MID140|PID171|FMI3"],
    ["MID128 SID16 water in fuel", "Engine ECU (MID 128)", "SID 16 FMI 5", "Water in fuel indicator", "MID128|SID18|FMI5"],
    ["MID130 PSID46 steering wheel buttons", "Gearbox ECU (MID 130)", "PSID 46 FMI 9", "Steering wheel buttons", "MID140|PSID46|FMI9"],
    ["MID216 PSID15 intermittent wiping relay", "Light Control Module (LCM) (MID 216)", "PSID 15 FMI 3", "Intermittent wiping relay", "MID216|PSID19|FMI3"],
    ["MID223 PSID20 PTO", "Power take-off ECU (MID 223)", "PSID 20 FMI 4", "PTO 1", "MID130|PSID20|FMI4"],
  ])("%s", (_name, unit, code, description, expected) => {
    expect(v3(unit, code, description)).toBe(expected)
  })

  it("never touches genuine rows (negative guards)", () => {
    const lcm = "Light Control Module (LCM) (MID 216)"
    expect(v3(lcm, "PSID 23 FMI 4", "Parking light left rear")).toBe("MID216|PSID23|FMI4")
    expect(v3(lcm, "PSID 15 FMI 3", "Turn signal lamp left rear")).toBe("MID216|PSID15|FMI3")
    expect(
      v3("Instrument Cluster ECU (MID 140)", "PID 177 FMI 3", "Transmission oil temperature")
    ).toBe("MID140|PID177|FMI3")
    expect(v3(lcm, "PID 84 FMI 2", "Something else")).toBe("MID216|PID84|FMI2")
    expect(v3("Engine ECU (MID 128)", "SID 16 FMI 5", "Injector")).toBe("MID128|SID16|FMI5")
    expect(v3("Gearbox ECU (MID 130)", "PSID 46 FMI 9", "Gearbox oil")).toBe("MID130|PSID46|FMI9")
    expect(v3("Power take-off ECU (MID 223)", "PSID 20 FMI 4", "Other")).toBe("MID223|PSID20|FMI4")
  })

  it("only fires on FH V3 trucks", () => {
    expect(
      keyOf({
        controlUnit: "Instrument Cluster ECU (MID 140)",
        faultCode: "PID 177 FMI 3",
        description: "Ambient air temperature",
        generation: "UNKNOWN",
      })
    ).toBe("MID140|PID177|FMI3")
  })

  it("re-keys both the baseline and the verification scan (Re-reconcile After-Scans)", () => {
    const lcm = "Light Control Module (LCM) (MID 216)"
    const baselineRows = [
      storedRow(lcm, "PID 84 FMI 2", "Road speed"),
      storedRow("Vehicle ECU (MID 144)", "PSID 39 FMI 4", "Rear load sensor", "MID144|PSID39|FMI4"),
    ]
    const verificationRows = [
      storedRow("Vehicle ECU (MID 144)", "PID 84 FMI 2", "Road speed", "MID144|PID84|FMI2"),
      storedRow(lcm, "PSID 39 FMI 4", "Rear load sensor"),
    ]
    const result = plan("MTL126", "FH_V3", { baselineRows, verificationRows })
    const buckets = keysByBucket(result)
    expect(buckets.get("CLEARED") ?? []).toEqual([])
    expect(buckets.get("NEW_REGRESSION") ?? []).toEqual([])
    expect(
      [
        ...(buckets.get("PERSISTING_OPEN") ?? []),
        ...(buckets.get("PERSISTING_EXCEPTION") ?? []),
      ].sort()
    ).toEqual(["MID144|PID84|FMI2", "MID144|PSID39|FMI4"])
    expect(
      result.baseline.updates.map((update) => update.values.canonicalKey)
    ).toContain("MID144|PID84|FMI2")
    expect(
      result.verification.updates.map((update) => update.values.canonicalKey)
    ).toContain("MID144|PSID39|FMI4")
    expect(result.repairedKeysCount).toBeGreaterThanOrEqual(2)
  })
})

describe("MTL22: FH V4 CIM / APM / CIOM rescues", () => {
  const v4 = (
    controlUnit: string,
    faultCode: string,
    description: string,
    generation: CanonicalKeyInput["generation"] = "FH_V4"
  ) => keyOf({ controlUnit, faultCode, description, generation })

  it("normalises Cab I/O Module (CIM) and bare CIM to CIOM on a CIOM DTC", () => {
    expect(normalizeEcuAcronym("Cab I/O Module (CIM)")).toBe("CIOM")
    expect(normalizeEcuAcronym("CIM", "CIOM")).toBe("CIOM")
    // Existing behaviour is kept: a bare CIM stays the CCIOM truncation.
    expect(normalizeEcuAcronym("CIM")).toBe("CCIOM")
    expect(normalizeEcuAcronym("Cab Chassis I/O Module (CIM)")).toBe("CCIOM")
    expect(v4("CIM", "C103715", "")).toBe("CCIOM|C103715")
  })

  it("APM U0028B8 (CAN communication chassis net) -> APM|U002886", () => {
    expect(
      v4("Air Production Module (APM)", "U0028B8", "CAN Communication Chassis Net")
    ).toBe("APM|U002886")
    expect(v4("APM", "U0028B8", "Something else")).toBe("APM|U0028B8")
    expect(v4("APM", "U0028B8", "CAN Communication Chassis Net", "UNKNOWN")).toBe(
      "APM|U0028B8"
    )
  })

  it("CIOM / CIM U1148E7 (flexible switch panel link) -> CIOM|U114E87", () => {
    const description = "Flexible Switch Panel Link"
    expect(v4("Cab I/O Module (CIOM)", "U1148E7", description)).toBe("CIOM|U114E87")
    expect(v4("Cab I/O Module (CIM)", "U1148E7", description)).toBe("CIOM|U114E87")
    expect(v4("CIM", "U1148E7", description)).toBe("CIOM|U114E87")
    // Guards: description and generation.
    expect(v4("Cab I/O Module (CIOM)", "U1148E7", "Other")).toBe("CIOM|U1148E7")
    expect(v4("CIOM", "U1148E7", description, "UNKNOWN")).toBe("CIOM|U1148E7")
    // A different, recognised module is never reassigned.
    expect(v4("Engine Control Module (EMS)", "U1148E7", description)).toBe(
      "EMS|U1148E7"
    )
  })
})
