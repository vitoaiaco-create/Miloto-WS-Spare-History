import { describe, expect, it } from "vitest"

import { checkSelectedFooterCoverage } from "./gates"

const rows = [
  "Engine Oil Temperature - Voltage Above Normal",
  "Transmission Tank Air Pressure - Low",
  "Water In Fuel Drain Valve - Open Circuit",
]

describe("checkSelectedFooterCoverage", () => {
  it("has nothing to compare when the footer was not read", () => {
    expect(checkSelectedFooterCoverage(null, rows)).toEqual({
      matched: null,
      message: null,
    })
    expect(checkSelectedFooterCoverage("   ", rows).matched).toBeNull()
  })

  it("matches the selected title against a transcribed row", () => {
    expect(
      checkSelectedFooterCoverage("Transmission Tank Air Pressure - Low", rows)
    ).toEqual({ matched: true, message: null })
  })

  it("tolerates truncated / differently punctuated titles", () => {
    expect(
      checkSelectedFooterCoverage("Engine oil temperature", rows).matched
    ).toBe(true)
    expect(
      checkSelectedFooterCoverage(
        "Water-in-fuel drain valve - open circuit (extra)",
        rows
      ).matched
    ).toBe(true)
  })

  it("warns (softly) when no transcribed row matches", () => {
    const check = checkSelectedFooterCoverage("Coolant Level Low", rows)
    expect(check.matched).toBe(false)
    expect(check.message).toContain("Coolant Level Low")
    expect(check.message).toMatch(/top of the DTC List/)
  })
})
