import { describe, expect, it } from "vitest"

import {
  buildGateOverride,
  checkScanCompleteness,
  checkTruckIdentity,
  findRecycledImages,
  formatRecycledImageError,
  type PriorScanHashes,
} from "./gates"

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)
const HASH_C = "c".repeat(64)

const prior: PriorScanHashes[] = [
  {
    scanId: 10,
    fleetId: "MTL12",
    scannedAt: new Date("2026-11-03T08:30:00.000Z"),
    imageHashes: [HASH_A],
  },
  {
    scanId: 11,
    fleetId: "MTL41",
    scannedAt: new Date("2026-11-20T08:30:00.000Z"),
    imageHashes: [HASH_B],
  },
]

describe("recycled image gate", () => {
  it("rejects an image already used by a different truck, naming truck and date", () => {
    const recycled = findRecycledImages([HASH_C, HASH_A], prior)
    expect(recycled).toHaveLength(1)
    expect(recycled[0]).toMatchObject({
      index: 1,
      previous: { fleetId: "MTL12", scanId: 10 },
    })
    const message = formatRecycledImageError(recycled, ["new.png", "old.png"])
    expect(message).toContain('"old.png"')
    expect(message).toContain("MTL12")
    expect(message).toContain("2026-11-03")
  })

  it("rejects an image already used by the same truck", () => {
    const recycled = findRecycledImages([HASH_B], prior)
    expect(recycled[0].previous?.fleetId).toBe("MTL41")
    expect(formatRecycledImageError(recycled, ["baseline.png"])).toContain(
      "MTL41 scan of 2026-11-20"
    )
  })

  it("rejects the same image uploaded twice in one batch", () => {
    const recycled = findRecycledImages([HASH_C, HASH_C], [])
    expect(recycled).toEqual([{ index: 1, hash: HASH_C, previous: null }])
    expect(formatRecycledImageError(recycled, ["a.png", "b.png"])).toContain(
      "duplicate of another image in this upload"
    )
  })

  it("reports the oldest scan an image first appeared in", () => {
    const recycled = findRecycledImages([HASH_A], [
      ...prior,
      {
        scanId: 99,
        fleetId: "MTL77",
        scannedAt: new Date("2026-11-25T00:00:00.000Z"),
        imageHashes: [HASH_A],
      },
    ])
    expect(recycled[0].previous?.scanId).toBe(10)
  })

  it("accepts fully fresh images", () => {
    expect(findRecycledImages([HASH_C], prior)).toEqual([])
  })
})

describe("header-count completeness gate", () => {
  it("flags INCOMPLETE_SCAN when fewer rows were extracted than the header says", () => {
    const check = checkScanCompleteness(15, 11)
    expect(check.isComplete).toBe(false)
    expect(check.missingCount).toBe(4)
    expect(check.message).toBe(
      "INCOMPLETE_SCAN: Captured 11 of 15 faults — upload the missing scroll page(s)"
    )
  })

  it("passes when every item was captured", () => {
    expect(checkScanCompleteness(15, 15).isComplete).toBe(true)
    expect(checkScanCompleteness(15, 15).message).toBeNull()
  })

  it("passes when more rows were extracted than the header (e.g. header read low)", () => {
    expect(checkScanCompleteness(14, 15).isComplete).toBe(true)
  })

  it("passes when the header count could not be read", () => {
    const check = checkScanCompleteness(null, 3)
    expect(check.isComplete).toBe(true)
    expect(check.missingCount).toBe(0)
  })

  it("treats a zero-row capture of a non-empty list as incomplete", () => {
    expect(checkScanCompleteness(5, 0).isComplete).toBe(false)
  })
})

describe("truck identity check", () => {
  it("flags a clearly different fleet number", () => {
    const check = checkTruckIdentity("MTL41", "WO 8841 MTL52")
    expect(check.conflict).toBe(true)
    expect(check.message).toContain("TRUCK_MISMATCH")
    expect(check.message).toContain("MTL52")
    expect(check.message).toContain("MTL41")
  })

  it.each(["MTL41", "mtl 41", "MTL-041", "WO-123 / MTL41 service"])(
    "accepts a work order that names the same truck: %s",
    (workOrder) => {
      expect(checkTruckIdentity("MTL41", workOrder).conflict).toBe(false)
    }
  )

  it.each([null, "", "   ", "WO12345", "123456", "Service A"])(
    "does not accuse on an unreadable or numeric-only work order: %j",
    (workOrder) => {
      expect(checkTruckIdentity("MTL41", workOrder).conflict).toBe(false)
    }
  )

  it("does not compare different prefixes (a trailer id is not a mismatch)", () => {
    expect(checkTruckIdentity("MTL41", "MT204").conflict).toBe(false)
  })
})

describe("gate overrides", () => {
  const at = new Date("2026-11-26T10:00:00.000Z")

  it("requires a reason", () => {
    expect(buildGateOverride("INCOMPLETE_SCAN", "   ", "user_1", at)).toBeNull()
  })

  it("logs who, why and when", () => {
    expect(
      buildGateOverride("INCOMPLETE_SCAN", " Header read wrong ", "user_1", at)
    ).toEqual({
      gate: "INCOMPLETE_SCAN",
      reason: "Header read wrong",
      by: "user_1",
      at: "2026-11-26T10:00:00.000Z",
    })
  })
})
