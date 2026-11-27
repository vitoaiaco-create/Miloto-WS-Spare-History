import { describe, expect, it } from "vitest"

import {
  MANUAL_CLOSE_BLOCKED_MESSAGE,
  canManuallyMarkVerifiedClosed,
  canSetWorkflowVerifiedClosed,
} from "./closure-guard"
import { PTT_CASE_STATUSES } from "./constants"

describe("canManuallyMarkVerifiedClosed", () => {
  it("rejects closure on an OPEN case", () => {
    expect(
      canManuallyMarkVerifiedClosed({
        caseStatus: "OPEN",
        latestVerificationCaseStatus: null,
      })
    ).toBe(false)
  })

  it("rejects closure on a PARTIAL_BLOCKED case", () => {
    expect(
      canManuallyMarkVerifiedClosed({
        caseStatus: "PARTIAL_BLOCKED",
        latestVerificationCaseStatus: "PARTIAL_BLOCKED",
      })
    ).toBe(false)
  })

  it("rejects closure on a REJECTED_NO_PROGRESS case", () => {
    expect(
      canManuallyMarkVerifiedClosed({
        caseStatus: "REJECTED_NO_PROGRESS",
        latestVerificationCaseStatus: "REJECTED_NO_PROGRESS",
      })
    ).toBe(false)
  })

  it("rejects closure when there is no passing verification scan", () => {
    expect(
      canManuallyMarkVerifiedClosed({
        caseStatus: "VERIFIED_CLOSED",
        latestVerificationCaseStatus: null,
      })
    ).toBe(false)
    expect(
      canManuallyMarkVerifiedClosed({
        caseStatus: "VERIFIED_CLOSED",
        latestVerificationCaseStatus: "PARTIAL_BLOCKED",
      })
    ).toBe(false)
  })

  it("lets a case that passed its verification scan stay closed", () => {
    expect(
      canManuallyMarkVerifiedClosed({
        caseStatus: "VERIFIED_CLOSED",
        latestVerificationCaseStatus: "VERIFIED_CLOSED",
      })
    ).toBe(true)
  })

  it("never allows any other baseline verdict to close", () => {
    for (const caseStatus of PTT_CASE_STATUSES) {
      if (caseStatus === "VERIFIED_CLOSED") continue
      expect(
        canManuallyMarkVerifiedClosed({
          caseStatus,
          latestVerificationCaseStatus: "VERIFIED_CLOSED",
        })
      ).toBe(false)
    }
  })

  it("does not treat a manager release as a passing verification", () => {
    expect(
      canManuallyMarkVerifiedClosed({
        caseStatus: "CLOSED_ACCEPTED_RESIDUALS",
        latestVerificationCaseStatus: "PARTIAL_BLOCKED",
      })
    ).toBe(false)
  })

  it("uses the agreed rejection message", () => {
    expect(MANUAL_CLOSE_BLOCKED_MESSAGE).toBe(
      "Cannot manually mark Verified Closed while blocking faults or regressions remain open. Upload a passing post-work PTT verification scan."
    )
  })
})

describe("canSetWorkflowVerifiedClosed", () => {
  it("keeps a case released with accepted residuals closed in the workflow", () => {
    expect(
      canSetWorkflowVerifiedClosed({
        caseStatus: "CLOSED_ACCEPTED_RESIDUALS",
        latestVerificationCaseStatus: "PARTIAL_BLOCKED",
      })
    ).toBe(true)
    expect(
      canSetWorkflowVerifiedClosed({
        caseStatus: "CLOSED_ACCEPTED_RESIDUALS",
        latestVerificationCaseStatus: null,
      })
    ).toBe(true)
  })

  it("otherwise follows the passing-scan rule", () => {
    expect(
      canSetWorkflowVerifiedClosed({
        caseStatus: "PARTIAL_BLOCKED",
        latestVerificationCaseStatus: "PARTIAL_BLOCKED",
      })
    ).toBe(false)
    expect(
      canSetWorkflowVerifiedClosed({
        caseStatus: "VERIFIED_CLOSED",
        latestVerificationCaseStatus: "VERIFIED_CLOSED",
      })
    ).toBe(true)
  })
})
