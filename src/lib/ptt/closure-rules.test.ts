import { describe, expect, it } from "vitest"

import {
  CLOSE_JOB_ALREADY_CLOSED_MESSAGE,
  CLOSE_JOB_BLOCKED_BASELINE_MESSAGE,
  canCloseWithAcceptedResiduals,
  collectClosureResiduals,
  countActionableBaselineFaults,
  evaluateClosureEligibility,
  isValidClosureNote,
  planClosureLedgerUpserts,
} from "./closure-rules"
import type { LedgerEntry } from "./ledger"

const ledgerEntry = (
  canonicalKey: string,
  overrides: Partial<LedgerEntry> = {}
): LedgerEntry => ({
  fleetId: "MTL121",
  canonicalKey,
  ecuLabel: "CCIOM",
  description: "",
  latestSeverity: "CRITICAL",
  ledgerStatus: "OPEN",
  firstSeenScanId: 1,
  lastSeenScanId: 2,
  clearedScanId: null,
  firstSeenAt: new Date(2026, 10, 1),
  lastSeenAt: new Date(2026, 10, 20),
  clearedAt: null,
  reopenCount: 0,
  lastReopenedAt: null,
  ...overrides,
})

describe("evaluateClosureEligibility", () => {
  it("allows closing a blocked case that has an AFTER photo", () => {
    for (const caseStatus of ["PARTIAL_BLOCKED", "REJECTED_NO_PROGRESS"] as const) {
      expect(
        evaluateClosureEligibility({
          caseStatus,
          hasVerificationScan: true,
          baselineActionableCount: 3,
        })
      ).toEqual({ allowed: true, basis: "VERIFICATION_SCAN" })
    }
  })

  it("allows a baseline-only case with zero Critical / Calibration faults", () => {
    expect(
      evaluateClosureEligibility({
        caseStatus: "OPEN",
        hasVerificationScan: false,
        baselineActionableCount: 0,
      })
    ).toEqual({ allowed: true, basis: "ZERO_CRITICAL_BASELINE" })
  })

  it("rejects a baseline-only case that still has Critical / Calibration faults", () => {
    const result = evaluateClosureEligibility({
      caseStatus: "OPEN",
      hasVerificationScan: false,
      baselineActionableCount: 2,
    })
    expect(result).toEqual({
      allowed: false,
      reason: CLOSE_JOB_BLOCKED_BASELINE_MESSAGE,
    })
  })

  it("rejects a case that is already closed (either way)", () => {
    for (const caseStatus of [
      "VERIFIED_CLOSED",
      "CLOSED_ACCEPTED_RESIDUALS",
    ] as const) {
      expect(
        evaluateClosureEligibility({
          caseStatus,
          hasVerificationScan: true,
          baselineActionableCount: 0,
        })
      ).toEqual({ allowed: false, reason: CLOSE_JOB_ALREADY_CLOSED_MESSAGE })
    }
  })

  it("rejects a verification verdict that is not blocked", () => {
    expect(
      canCloseWithAcceptedResiduals({
        caseStatus: "REJECTED_INCOMPLETE",
        hasVerificationScan: true,
        baselineActionableCount: 0,
      })
    ).toBe(false)
  })
})

describe("countActionableBaselineFaults", () => {
  it("counts only active, non-exempt Critical / Calibration faults", () => {
    expect(
      countActionableBaselineFaults([
        { pttStatus: "ACTIVE", severity: "CRITICAL", isApprovedException: false },
        {
          pttStatus: "ACTIVE",
          severity: "CALIBRATION_ONLY",
          isApprovedException: false,
        },
        { pttStatus: "ACTIVE", severity: "MONITOR", isApprovedException: false },
        { pttStatus: "INACTIVE", severity: "CRITICAL", isApprovedException: false },
        { pttStatus: "ACTIVE", severity: "CRITICAL", isApprovedException: true },
      ])
    ).toBe(2)
  })
})

describe("closure note", () => {
  it("needs at least 5 trimmed characters", () => {
    expect(isValidClosureNote("   ab  ")).toBe(false)
    expect(isValidClosureNote("abcd")).toBe(false)
    expect(isValidClosureNote("  abcde ")).toBe(true)
  })
})

describe("collectClosureResiduals", () => {
  const base = { ecuLabel: "CCIOM", description: "", severity: "CRITICAL" } as const

  it("takes Still Open + New Regression faults of the re-scan", () => {
    const residuals = collectClosureResiduals({
      reconciled: [
        { ...base, canonicalKey: "CCIOM|C103715", bucket: "PERSISTING_OPEN" },
        { ...base, canonicalKey: "EMS|P00B7", bucket: "NEW_REGRESSION" },
        { ...base, canonicalKey: "TECU|U3000", bucket: "CLEARED" },
        { ...base, canonicalKey: "BBM|B1", bucket: "PERSISTING_EXCEPTION" },
        { ...base, canonicalKey: "CCIOM|C103715", bucket: "NEW_REGRESSION" },
      ],
      baseline: [],
    })
    expect(residuals.map((fault) => fault.canonicalKey)).toEqual([
      "CCIOM|C103715",
      "EMS|P00B7",
    ])
  })

  it("uses the active, non-exempt baseline faults for a baseline-only closure", () => {
    const residuals = collectClosureResiduals({
      reconciled: null,
      baseline: [
        {
          ...base,
          severity: "MONITOR",
          canonicalKey: "BBM|B2",
          pttStatus: "ACTIVE",
          isApprovedException: false,
        },
        {
          ...base,
          severity: "MONITOR",
          canonicalKey: "BBM|B3",
          pttStatus: "INACTIVE",
          isApprovedException: false,
        },
        {
          ...base,
          severity: "MONITOR",
          canonicalKey: "BBM|B4",
          pttStatus: "ACTIVE",
          isApprovedException: true,
        },
      ],
    })
    expect(residuals.map((fault) => fault.canonicalKey)).toEqual(["BBM|B2"])
  })
})

describe("planClosureLedgerUpserts", () => {
  const ledger = new Map<string, LedgerEntry>([
    ["CCIOM|C103715", ledgerEntry("CCIOM|C103715")],
    ["EMS|P00B7", ledgerEntry("EMS|P00B7", { ledgerStatus: "REOPENED" })],
    ["TECU|U3000", ledgerEntry("TECU|U3000", { ledgerStatus: "CLEARED" })],
  ])

  it("marks open residuals APPROVED_EXCEPTION when saved as exceptions", () => {
    const upserts = planClosureLedgerUpserts({
      residualKeys: ["CCIOM|C103715", "EMS|P00B7", "TECU|U3000", "UNKNOWN|X"],
      saveResidualsAsExceptions: true,
      ledger,
    })
    expect(upserts.map((entry) => [entry.canonicalKey, entry.ledgerStatus])).toEqual([
      ["CCIOM|C103715", "APPROVED_EXCEPTION"],
      ["EMS|P00B7", "APPROVED_EXCEPTION"],
    ])
  })

  it("leaves the ledger OPEN when residuals are not saved as exceptions", () => {
    expect(
      planClosureLedgerUpserts({
        residualKeys: ["CCIOM|C103715", "EMS|P00B7"],
        saveResidualsAsExceptions: false,
        ledger,
      })
    ).toEqual([])
    expect(ledger.get("CCIOM|C103715")?.ledgerStatus).toBe("OPEN")
  })
})
