import { describe, expect, it } from "vitest"

import {
  formatPttVerificationAuditForWhatsApp,
  type PttAuditFault,
  type PttVerificationAuditInput,
} from "./audit-format"

const fault = (
  overrides: Partial<PttAuditFault> & Pick<PttAuditFault, "canonicalKey">
): PttAuditFault => ({
  ecuLabel: "EMS",
  description: "Some fault",
  severity: "CRITICAL",
  reconciliationBucket: null,
  isBounceBack: false,
  ...overrides,
})

const base: PttVerificationAuditInput = {
  fleetId: "MTL41",
  caseStatus: "PARTIAL_BLOCKED",
  scannedAt: new Date(2026, 10, 26, 9, 30),
  summary: {
    baselineActiveCount: 3,
    verificationActiveCount: 3,
    clearedCount: 1,
    persistingOpenCount: 1,
    persistingExceptionCount: 1,
    newRegressionCount: 1,
    newExceptionCount: 0,
    bounceBackCount: 1,
  },
  headerItemCount: 3,
  extractedItemCount: 3,
  gateOverrides: [],
  faults: [
    fault({ canonicalKey: "MID128|PID94|FMI3", reconciliationBucket: "CLEARED" }),
    fault({
      canonicalKey: "MID144|PID84|FMI2",
      reconciliationBucket: "PERSISTING_OPEN",
      isBounceBack: true,
    }),
    fault({
      canonicalKey: "MID136|SID1|FMI4",
      reconciliationBucket: "PERSISTING_EXCEPTION",
      severity: "MONITOR",
    }),
    fault({
      canonicalKey: "MID130|PID177|FMI0",
      reconciliationBucket: "NEW_REGRESSION",
    }),
  ],
}

describe("formatPttVerificationAuditForWhatsApp", () => {
  const message = formatPttVerificationAuditForWhatsApp(base)

  it("states the case status, fleet and equation", () => {
    expect(message).toContain("*Fleet ID:* MTL41")
    expect(message).toContain("PARTIAL / BLOCKED")
    expect(message).toContain(
      "3 before − 1 cleared + 1 regression + 0 new exception = 3 active now"
    )
    expect(message).toContain("*Faults read:* 3 of 3")
  })

  it("lists every bucket with its keys and flags bounce-backs", () => {
    expect(message).toContain("*Cleared (1):*")
    expect(message).toContain("*Still Open — Action Required (1):*")
    expect(message).toContain("*New Regressions (introduced) (1):*")
    expect(message).toContain("`MID144|PID84|FMI2`")
    expect(message).toMatch(/MID144\|PID84\|FMI2.*BOUNCE-BACK/)
    expect(message).not.toMatch(/MID128\|PID94\|FMI3.*BOUNCE-BACK/)
  })

  it("puts actionable buckets before the cleared list", () => {
    expect(message.indexOf("Still Open")).toBeLessThan(
      message.indexOf("*Cleared")
    )
    expect(message.indexOf("New Regressions")).toBeLessThan(
      message.indexOf("Still Open")
    )
  })

  it("omits empty buckets and the overrides block", () => {
    expect(message).not.toContain("New — Approved Exception")
    expect(message).not.toContain("Manager overrides")
  })

  it("logs manager gate overrides", () => {
    const overridden = formatPttVerificationAuditForWhatsApp({
      ...base,
      gateOverrides: [
        {
          gate: "INCOMPLETE_SCAN",
          reason: "Scroll bar broken on the unit",
          by: "user_1",
          at: "2026-11-26T09:30:00.000Z",
        },
      ],
    })
    expect(overridden).toContain("*⚠️ Manager overrides logged:*")
    expect(overridden).toContain("INCOMPLETE_SCAN: Scroll bar broken on the unit")
  })
})
