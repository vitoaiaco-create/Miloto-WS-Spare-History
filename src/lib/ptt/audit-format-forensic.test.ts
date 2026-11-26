import { describe, expect, it } from "vitest"

import {
  formatPttVerificationAuditForWhatsApp,
  type PttVerificationAuditInput,
} from "./audit-format"

const base: PttVerificationAuditInput = {
  fleetId: "MTL41",
  caseStatus: "PARTIAL_BLOCKED",
  scannedAt: new Date(2026, 10, 26, 9, 30),
  summary: null,
  headerItemCount: null,
  extractedItemCount: null,
  gateOverrides: [],
  faults: [],
}

describe("WhatsApp audit: forensic verification audit", () => {
  it("includes the verdict headline and collateral damage analysis", () => {
    const text = formatPttVerificationAuditForWhatsApp({
      ...base,
      verificationAudit: {
        verdictHeadline: "3 cleared, 1 blocker open, 1 regression.",
        collateralDamageAnalysis:
          "MID128|PID26|FMI3 sits on the MID 128 loom disturbed to clear PID 94.",
      },
    })
    expect(text).toContain("*Verdict:* 3 cleared, 1 blocker open, 1 regression.")
    expect(text).toContain("*⚠️ Collateral Damage Analysis:*")
    expect(text).toContain("MID128|PID26|FMI3 sits on the MID 128 loom")
  })

  it("omits the collateral section when there is none", () => {
    const text = formatPttVerificationAuditForWhatsApp({
      ...base,
      verificationAudit: {
        verdictHeadline: "All clear.",
        collateralDamageAnalysis: null,
      },
    })
    expect(text).toContain("*Verdict:* All clear.")
    expect(text).not.toContain("Collateral Damage Analysis")
  })

  it("is unchanged for older scans with no audit", () => {
    const withNull = formatPttVerificationAuditForWhatsApp({
      ...base,
      verificationAudit: null,
    })
    const without = formatPttVerificationAuditForWhatsApp(base)
    expect(withNull).toBe(without)
    expect(without).not.toContain("*Verdict:*")
  })
})
