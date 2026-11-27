import { describe, expect, it } from "vitest"

import { PTT_CASE_STATUSES } from "./constants"
import { countOpenBlockingTrucks, isBlockedWithAfterPhoto } from "./workshop-kpis"

describe("countOpenBlockingTrucks", () => {
  it("counts open / blocked trucks with a Critical or Calibration fault", () => {
    expect(
      countOpenBlockingTrucks([
        { caseStatus: "OPEN", overallSeverity: "CRITICAL" },
        { caseStatus: "PARTIAL_BLOCKED", overallSeverity: "CALIBRATION_ONLY" },
        { caseStatus: "REJECTED_NO_PROGRESS", overallSeverity: "CRITICAL" },
        { caseStatus: "OPEN", overallSeverity: "MONITOR" },
      ])
    ).toBe(3)
  })

  it("drops trucks closed cleanly or with accepted residuals", () => {
    expect(
      countOpenBlockingTrucks([
        { caseStatus: "VERIFIED_CLOSED", overallSeverity: "CRITICAL" },
        { caseStatus: "CLOSED_ACCEPTED_RESIDUALS", overallSeverity: "CRITICAL" },
        { caseStatus: "CLOSED_ACCEPTED_RESIDUALS", overallSeverity: "CALIBRATION_ONLY" },
        { caseStatus: "OPEN", overallSeverity: "CRITICAL" },
      ])
    ).toBe(1)
  })

  it("never counts a closed status, whatever the severity", () => {
    for (const caseStatus of PTT_CASE_STATUSES) {
      if (caseStatus !== "VERIFIED_CLOSED" && caseStatus !== "CLOSED_ACCEPTED_RESIDUALS") {
        continue
      }
      expect(
        countOpenBlockingTrucks([{ caseStatus, overallSeverity: "CRITICAL" }])
      ).toBe(0)
    }
  })
})

describe("isBlockedWithAfterPhoto", () => {
  it("matches blocked cases that have a verification scan", () => {
    expect(
      isBlockedWithAfterPhoto({ caseStatus: "PARTIAL_BLOCKED", hasVerificationScan: true })
    ).toBe(true)
    expect(
      isBlockedWithAfterPhoto({
        caseStatus: "REJECTED_NO_PROGRESS",
        hasVerificationScan: true,
      })
    ).toBe(true)
  })

  it("ignores baseline-only, closed and unblocked cases", () => {
    expect(
      isBlockedWithAfterPhoto({ caseStatus: "OPEN", hasVerificationScan: false })
    ).toBe(false)
    expect(
      isBlockedWithAfterPhoto({
        caseStatus: "CLOSED_ACCEPTED_RESIDUALS",
        hasVerificationScan: true,
      })
    ).toBe(false)
    expect(
      isBlockedWithAfterPhoto({ caseStatus: "VERIFIED_CLOSED", hasVerificationScan: true })
    ).toBe(false)
  })
})
