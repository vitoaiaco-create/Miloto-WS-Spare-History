import { describe, expect, it } from "vitest"

import type { LedgerEntry } from "./ledger"
import {
  planReconcileExistingCase,
  type CaseSessionState,
  type PlanException,
  type ReconcileExistingInput,
  type StoredFaultRow,
} from "./reconcile-existing-plan"

const NOW = new Date("2026-11-27T08:00:00Z")
const BASELINE_AT = new Date("2026-11-10T08:00:00Z")

let nextId = 1
function row(
  ecuLabel: string,
  dtcRaw: string,
  canonicalKey: string,
  overrides: Partial<StoredFaultRow> = {}
): StoredFaultRow {
  return {
    id: nextId++,
    canonicalKey,
    ecuLabel,
    dtcRaw,
    description: "",
    pttStatus: "ACTIVE",
    severity: "CRITICAL",
    reconciliationBucket: null,
    isBounceBack: false,
    isApprovedException: false,
    isExtracted: true,
    keyNeedsReview: true,
    keyReviewReason: "Control unit is not a known FH V4 module",
    ...overrides,
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

const fleetException = (canonicalKey: string): PlanException => ({
  scope: "FLEET_GENERATION",
  generation: "FH_V4",
  fleetId: null,
  canonicalKey,
  isActive: true,
})

function ledgerEntry(
  canonicalKey: string,
  overrides: Partial<LedgerEntry> = {}
): LedgerEntry {
  return {
    fleetId: "MTL121",
    canonicalKey,
    ecuLabel: "",
    description: "",
    latestSeverity: "CRITICAL",
    ledgerStatus: "OPEN",
    firstSeenScanId: 1,
    lastSeenScanId: 1,
    clearedScanId: null,
    firstSeenAt: BASELINE_AT,
    lastSeenAt: BASELINE_AT,
    clearedAt: null,
    reopenCount: 0,
    lastReopenedAt: null,
    ...overrides,
  }
}

function plan(overrides: Partial<ReconcileExistingInput>) {
  return planReconcileExistingCase({
    fleetId: "MTL121",
    generation: "FH_V4",
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

describe("MTL121 real-world re-reconciliation (garbled CCIOM OCR)", () => {
  // As stored before the normaliser fix: both scans kept the CCIOM row under
  // different UNVERIFIED stand-ins, so it looked like a regression.
  const baselineCciom = row(
    "CCIODM",
    "C103715",
    "UNVERIFIED|CCIODM|C103715"
  )
  const verificationCciom = row(
    "Cab Chassis I/O Module (CIM)",
    "C103715",
    "UNVERIFIED|CABCHASSISIOMODULECIM|C103715"
  )
  const clearedBaseline = [
    row("Engine Control Module (EMS)", "P111D00", "EMS|P111D00"),
    row("Aftertreatment Control Module (ACM)", "P107B13", "ACM|P107B13"),
    row("Air Production Modulator (APM)", "C101024", "APM|C101024"),
    row("Rear Chassis I/O Module (RCIOM)", "C114864", "RCIOM|C114864"),
  ]
  const staleSynthetic = [
    ...clearedBaseline.map((fault) =>
      row(fault.ecuLabel, fault.dtcRaw, fault.canonicalKey, {
        pttStatus: "INACTIVE",
        isExtracted: false,
        reconciliationBucket: "CLEARED",
      })
    ),
    row("CCIODM", "C103715", "UNVERIFIED|CCIODM|C103715", {
      pttStatus: "INACTIVE",
      isExtracted: false,
      reconciliationBucket: "CLEARED",
    }),
  ]
  const verificationScanRow = { ...verificationCciom, reconciliationBucket: "NEW_REGRESSION" as const }

  const result = plan({
    baselineRows: [baselineCciom, ...clearedBaseline],
    verificationRows: [verificationScanRow, ...staleSynthetic],
    exceptions: [fleetException("CCIOM|C103715")],
    ledger: new Map([
      [
        "UNVERIFIED|CCIODM|C103715",
        ledgerEntry("UNVERIFIED|CCIODM|C103715", {
          ledgerStatus: "CLEARED",
          clearedScanId: 2,
          clearedAt: NOW,
          reopenCount: 1,
        }),
      ],
      [
        "UNVERIFIED|CABCHASSISIOMODULECIM|C103715",
        ledgerEntry("UNVERIFIED|CABCHASSISIOMODULECIM|C103715", {
          firstSeenScanId: 2,
          firstSeenAt: NOW,
        }),
      ],
    ]),
  })

  it("keys both scans as CCIOM|C103715", () => {
    expect(
      result.baseline.updates.find((update) => update.id === baselineCciom.id)
        ?.values.canonicalKey
    ).toBe("CCIOM|C103715")
    expect(
      result.verification.updates.find(
        (update) => update.id === verificationCciom.id
      )?.values.canonicalKey
    ).toBe("CCIOM|C103715")
    expect(result.repairedKeysCount).toBe(2)
  })

  it("matches the fleet exception and reports the corrected equation", () => {
    expect(result.result.summary).toMatchObject({
      clearedCount: 4,
      newRegressionCount: 0,
      persistingOpenCount: 0,
      persistingExceptionCount: 1,
    })
    const persisting = result.verification.updates.find(
      (update) => update.id === verificationCciom.id
    )?.values
    expect(persisting?.reconciliationBucket).toBe("PERSISTING_EXCEPTION")
    expect(persisting?.isApprovedException).toBe(true)
    expect(persisting?.severity).toBe("NEGLIGIBLE")
  })

  it("upgrades the case to a clean Verified Closed", () => {
    expect(result.session).toMatchObject({
      caseStatus: "VERIFIED_CLOSED",
      workflowStatus: "VERIFIED_CLOSED",
      closureMode: "CLEAN",
      closedAt: NOW,
    })
    expect(result.upgradedToClean).toBe(true)
  })

  it("rebuilds the synthetic 'absent from screenshots' rows", () => {
    expect(result.verification.deleteIds).toEqual(
      staleSynthetic.map((fault) => fault.id)
    )
    expect(
      result.verification.inserts.map((insert) => insert.canonicalKey).sort()
    ).toEqual(
      ["ACM|P107B13", "APM|C101024", "EMS|P111D00", "RCIOM|C114864"].sort()
    )
    expect(
      result.verification.inserts.every(
        (insert) => !insert.isExtracted && insert.reconciliationBucket === "CLEARED"
      )
    ).toBe(true)
  })

  it("repairs the ledger: new key carries the history, legacy keys are orphan candidates", () => {
    const repaired = result.ledgerUpserts.find(
      (entry) => entry.canonicalKey === "CCIOM|C103715"
    )
    expect(repaired?.ledgerStatus).toBe("APPROVED_EXCEPTION")
    expect(repaired?.reopenCount).toBe(1)
    expect(repaired?.firstSeenAt).toEqual(BASELINE_AT)
    expect([...result.orphanLedgerKeyCandidates].sort()).toEqual([
      "UNVERIFIED|CABCHASSISIOMODULECIM|C103715",
      "UNVERIFIED|CCIODM|C103715",
    ])
  })
})

describe("re-reconciliation of duplicate / collapsing keys", () => {
  it("collapses rows that normalise to one key (ACTIVE beats INACTIVE)", () => {
    const active = row("CCIOIM", "C103715", "UNVERIFIED|CCIOIM|C103715")
    const inactive = row("CCIOM", "C103715", "CCIOM|C103715", {
      pttStatus: "INACTIVE",
      severity: "NEGLIGIBLE",
      keyNeedsReview: false,
      keyReviewReason: null,
    })
    const result = plan({
      baselineRows: [active],
      verificationRows: [inactive, row("CC1OM", "C103715", "UNVERIFIED|CC1OM|C103715")],
    })
    // The row already holding the canonical key survives, the other is deleted.
    expect(result.verification.deleteIds).toHaveLength(1)
    const survivor = result.verification.updates.find(
      (update) => update.id === inactive.id
    )
    expect(survivor?.values.pttStatus).toBe("ACTIVE")
    expect(survivor?.values.canonicalKey).toBe("CCIOM|C103715")
  })

  it("leaves an already-correct case untouched", () => {
    const base = row("Engine Control Module (EMS)", "P111D00", "EMS|P111D00", {
      keyNeedsReview: false,
      keyReviewReason: null,
    })
    const result = plan({ baselineRows: [base], verificationRows: [] })
    expect(result.baseline.updates).toHaveLength(0)
    expect(result.baseline.deleteIds).toHaveLength(0)
    expect(result.repairedKeysCount).toBe(0)
  })
})

describe("closed with accepted residuals", () => {
  const residual = "EBS|C006154" // missing calibration: blocking while not exempt
  const baseline = row("Electronic Brake System (EBS)", "C006154", residual, {
    keyNeedsReview: false,
    keyReviewReason: null,
  })
  const verification = row("Electronic Brake System (EBS)", "C006154", residual, {
    keyNeedsReview: false,
    keyReviewReason: null,
  })
  const closedSession: CaseSessionState = {
    caseStatus: "CLOSED_ACCEPTED_RESIDUALS",
    workflowStatus: "VERIFIED_CLOSED",
    verifiedAt: NOW,
    closureMode: "ACCEPTED_RESIDUALS",
    closureReasonCategory: "DEFERRED_TO_PM",
    closureNote: "Calibrate at PM",
    closedBy: "user_1",
    closedAt: NOW,
  }
  const truckException = (createdByClosure: boolean): PlanException => ({
    scope: "TRUCK_SPECIFIC",
    generation: null,
    fleetId: "MTL121",
    canonicalKey: residual,
    isActive: true,
    createdByClosure,
  })

  it("stays CLOSED_ACCEPTED_RESIDUALS while only the closure's own exceptions cover the residual", () => {
    const result = plan({
      baselineRows: [baseline],
      verificationRows: [verification],
      exceptions: [truckException(true)],
      session: closedSession,
    })
    expect(result.session.caseStatus).toBe("CLOSED_ACCEPTED_RESIDUALS")
    expect(result.session.closureMode).toBe("ACCEPTED_RESIDUALS")
    expect(result.session.closureNote).toBe("Calibrate at PM")
    expect(result.upgradedToClean).toBe(false)
  })

  it("stays accepted when the residual was kept OPEN (no exception saved)", () => {
    const result = plan({
      baselineRows: [baseline],
      verificationRows: [verification],
      exceptions: [],
      session: closedSession,
    })
    expect(result.session.caseStatus).toBe("CLOSED_ACCEPTED_RESIDUALS")
    expect(result.result.summary.persistingOpenCount).toBe(1)
  })

  it("upgrades to a clean closure once an independent exception covers it", () => {
    const result = plan({
      baselineRows: [baseline],
      verificationRows: [verification],
      exceptions: [truckException(false)],
      session: closedSession,
    })
    expect(result.session).toMatchObject({
      caseStatus: "VERIFIED_CLOSED",
      closureMode: "CLEAN",
      closureReasonCategory: null,
      closureNote: null,
      closedAt: NOW,
    })
    expect(result.upgradedToClean).toBe(true)
  })

  it("demotes a clean closure that the data no longer supports", () => {
    const result = plan({
      baselineRows: [baseline],
      verificationRows: [verification],
      exceptions: [],
      session: {
        ...openSession,
        caseStatus: "VERIFIED_CLOSED",
        workflowStatus: "VERIFIED_CLOSED",
        verifiedAt: NOW,
        closureMode: "CLEAN",
        closedAt: NOW,
      },
    })
    expect(result.session.caseStatus).toBe("REJECTED_NO_PROGRESS")
    expect(result.session.workflowStatus).toBe("IN_PROGRESS")
    expect(result.session.closureMode).toBeNull()
    expect(result.session.closedAt).toBeNull()
  })
})
