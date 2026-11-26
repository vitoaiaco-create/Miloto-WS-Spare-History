import { describe, expect, it } from "vitest"

import type { PttReconciliationBucket } from "./constants"
import type { ReconciledFault } from "./reconcile"
import {
  buildVerificationAuditInput,
  normalizeVerificationAudit,
  pttVerificationAuditSchema,
  type PttVerificationAudit,
  type VerificationAuditFault,
  type VerificationAuditInput,
} from "./verification-audit-schema"

function reconciled(
  canonicalKey: string,
  bucket: PttReconciliationBucket,
  overrides: Partial<ReconciledFault> = {}
): ReconciledFault {
  return {
    canonicalKey,
    bucket,
    severity: "CRITICAL",
    isApprovedException: false,
    isBounceBack: false,
    ecuLabel: "Engine ECU (MID 128)",
    dtcRaw: canonicalKey,
    description: canonicalKey,
    presentInVerification: true,
    verificationStatus: "ACTIVE",
    ...overrides,
  }
}

const emptyBuckets = (): Record<PttReconciliationBucket, ReconciledFault[]> => ({
  CLEARED: [],
  PERSISTING_OPEN: [],
  PERSISTING_EXCEPTION: [],
  NEW_REGRESSION: [],
  NEW_EXCEPTION: [],
})

const fault = (
  canonicalKey: string,
  overrides: Partial<VerificationAuditFault> = {}
): VerificationAuditFault => ({
  canonicalKey,
  ecuLabel: "Engine ECU (MID 128)",
  description: canonicalKey,
  severity: "CRITICAL",
  isBounceBack: false,
  reopenCount: 0,
  ...overrides,
})

const baseInput = (
  overrides: Partial<VerificationAuditInput> = {}
): VerificationAuditInput => ({
  caseStatus: "PARTIAL_BLOCKED",
  cleared: [],
  persistingOpen: [],
  newRegressions: [],
  persistingExceptions: [],
  newExceptions: [],
  bounceBackItems: [],
  ...overrides,
})

const modelAudit = (
  overrides: Partial<PttVerificationAudit> = {}
): PttVerificationAudit => ({
  verdictHeadline: "Two cleared, one still open.",
  collateralDamageAnalysis: null,
  untouchedBlockersSummary: null,
  repeatFaultEscalation: null,
  nextFloorActions: ["Check the MID 128 connector."],
  ...overrides,
})

describe("buildVerificationAuditInput", () => {
  it("maps the five buckets and flags bounce-backs by flag or reopen count", () => {
    const buckets = emptyBuckets()
    buckets.CLEARED.push(reconciled("MID128|PID94|FMI3", "CLEARED"))
    buckets.NEW_REGRESSION.push(
      reconciled("MID128|PID26|FMI3", "NEW_REGRESSION", { isBounceBack: true })
    )
    buckets.PERSISTING_OPEN.push(
      reconciled("MID130|PID37|FMI1", "PERSISTING_OPEN")
    )
    buckets.PERSISTING_EXCEPTION.push(
      reconciled("MID144|PSID23|FMI5", "PERSISTING_EXCEPTION")
    )
    buckets.NEW_EXCEPTION.push(
      reconciled("MID249|SID1|FMI5", "NEW_EXCEPTION")
    )

    const input = buildVerificationAuditInput(
      buckets,
      "PARTIAL_BLOCKED",
      new Map([["MID130|PID37|FMI1", 2]])
    )

    expect(input.caseStatus).toBe("PARTIAL_BLOCKED")
    expect(input.cleared.map((f) => f.canonicalKey)).toEqual(["MID128|PID94|FMI3"])
    expect(input.newRegressions.map((f) => f.canonicalKey)).toEqual([
      "MID128|PID26|FMI3",
    ])
    expect(input.persistingExceptions).toHaveLength(1)
    expect(input.newExceptions).toHaveLength(1)
    expect(input.bounceBackItems.map((f) => f.canonicalKey).sort()).toEqual([
      "MID128|PID26|FMI3",
      "MID130|PID37|FMI1",
    ])
    expect(
      input.persistingOpen.find((f) => f.canonicalKey === "MID130|PID37|FMI1")
        ?.reopenCount
    ).toBe(2)
  })
})

describe("normalizeVerificationAudit", () => {
  it("accepts the model's strict-schema shape", () => {
    expect(pttVerificationAuditSchema.safeParse(modelAudit()).success).toBe(true)
  })

  it("requires collateralDamageAnalysis whenever there is a regression", () => {
    const input = baseInput({
      cleared: [fault("MID128|PID94|FMI3")],
      newRegressions: [fault("MID128|PID26|FMI3")],
    })
    const fixed = normalizeVerificationAudit(modelAudit(), input)
    expect(fixed.collateralDamageAnalysis).toContain("MID128|PID26|FMI3")
    expect(fixed.collateralDamageAnalysis).toContain("MID128|PID94|FMI3")

    const kept = normalizeVerificationAudit(
      modelAudit({ collateralDamageAnalysis: "Loom disturbed on MID 128." }),
      input
    )
    expect(kept.collateralDamageAnalysis).toBe("Loom disturbed on MID 128.")
  })

  it("nulls collateralDamageAnalysis when there are no regressions", () => {
    const fixed = normalizeVerificationAudit(
      modelAudit({ collateralDamageAnalysis: "invented" }),
      baseInput()
    )
    expect(fixed.collateralDamageAnalysis).toBeNull()
  })

  it("requires repeatFaultEscalation for a bounce-back / reopenCount >= 1", () => {
    const repeated = fault("MID128|PID94|FMI3", { reopenCount: 1 })
    const fixed = normalizeVerificationAudit(
      modelAudit(),
      baseInput({ persistingOpen: [repeated], bounceBackItems: [repeated] })
    )
    expect(fixed.repeatFaultEscalation).toMatch(/pin drag test/)
    expect(fixed.repeatFaultEscalation).toMatch(/Do NOT clear the DTC/)

    expect(
      normalizeVerificationAudit(
        modelAudit({ repeatFaultEscalation: "invented" }),
        baseInput()
      ).repeatFaultEscalation
    ).toBeNull()
  })

  it("only reports blocking (Critical / Calibration) persisting faults", () => {
    const monitor = fault("MID140|PSID46|FMI5", { severity: "MONITOR" })
    expect(
      normalizeVerificationAudit(
        modelAudit({ untouchedBlockersSummary: "invented" }),
        baseInput({ persistingOpen: [monitor] })
      ).untouchedBlockersSummary
    ).toBeNull()

    const blocker = fault("MID130|PID37|FMI1")
    expect(
      normalizeVerificationAudit(
        modelAudit(),
        baseInput({ persistingOpen: [blocker, monitor] })
      ).untouchedBlockersSummary
    ).toContain("MID130|PID37|FMI1")
  })

  it("keeps 1-4 floor actions and never returns an empty list", () => {
    const many = modelAudit({
      nextFloorActions: ["a", " ", "b", "c", "d", "e"],
    })
    expect(normalizeVerificationAudit(many, baseInput()).nextFloorActions).toEqual([
      "a",
      "b",
      "c",
      "d",
    ])

    const empty = normalizeVerificationAudit(
      modelAudit({ nextFloorActions: [] }),
      baseInput({ newRegressions: [fault("MID128|PID26|FMI3")] })
    )
    expect(empty.nextFloorActions.length).toBeGreaterThanOrEqual(1)
    expect(empty.nextFloorActions.length).toBeLessThanOrEqual(4)
  })

  it("fills a missing headline", () => {
    const fixed = normalizeVerificationAudit(
      modelAudit({ verdictHeadline: "  " }),
      baseInput({ caseStatus: "VERIFIED_CLOSED", cleared: [fault("a|b")] })
    )
    expect(fixed.verdictHeadline).toMatch(/verified/i)
  })

  it("produces a complete audit even when the model call produced nothing", () => {
    const fixed = normalizeVerificationAudit(null, baseInput())
    expect(fixed.verdictHeadline).not.toBe("")
    expect(fixed.nextFloorActions).toHaveLength(1)
  })
})
