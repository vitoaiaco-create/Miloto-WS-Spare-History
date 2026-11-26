import { describe, expect, it } from "vitest"

import {
  isWithinBounceBackWindow,
  ledgerDaysOpen,
  planLedgerCommit,
  type LedgerEntry,
  type LedgerScanFault,
} from "./ledger"

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date("2026-11-26T10:00:00.000Z")
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY)

const KEY = "MID128|PID94|FMI5"

const activeFault = (
  canonicalKey = KEY,
  isApprovedException = false
): LedgerScanFault => ({
  canonicalKey,
  ecuLabel: "Engine ECU (MID 128)",
  description: "Coolant temperature sensor",
  severity: "CRITICAL",
  isApprovedException,
})

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    fleetId: "MTL41",
    canonicalKey: KEY,
    ecuLabel: "Engine ECU (MID 128)",
    description: "Coolant temperature sensor",
    latestSeverity: "CRITICAL",
    ledgerStatus: "OPEN",
    firstSeenScanId: 1,
    lastSeenScanId: 1,
    clearedScanId: null,
    firstSeenAt: daysAgo(40),
    lastSeenAt: daysAgo(40),
    clearedAt: null,
    reopenCount: 0,
    lastReopenedAt: null,
    ...overrides,
  }
}

const map = (...entries: LedgerEntry[]) =>
  new Map(entries.map((e) => [e.canonicalKey, e]))

describe("planLedgerCommit - 30-day bounce-back", () => {
  it("reopens a fault cleared 10 days ago and increments reopenCount to 1", () => {
    const plan = planLedgerCommit({
      fleetId: "MTL41",
      scanId: 7,
      now: NOW,
      activeFaults: [activeFault()],
      existing: map(
        entry({
          ledgerStatus: "CLEARED",
          clearedScanId: 3,
          clearedAt: daysAgo(10),
          reopenCount: 0,
        })
      ),
    })

    expect(plan.bounceBackKeys).toEqual(new Set([KEY]))
    expect(plan.upserts).toHaveLength(1)
    expect(plan.upserts[0]).toMatchObject({
      canonicalKey: KEY,
      ledgerStatus: "REOPENED",
      reopenCount: 1,
      lastReopenedAt: NOW,
      lastSeenScanId: 7,
      lastSeenAt: NOW,
      clearedAt: null,
      clearedScanId: null,
      firstSeenScanId: 1,
    })
  })

  it("counts every further bounce-back (reopenCount keeps climbing)", () => {
    const plan = planLedgerCommit({
      fleetId: "MTL41",
      scanId: 9,
      now: NOW,
      activeFaults: [activeFault()],
      existing: map(
        entry({
          ledgerStatus: "CLEARED",
          clearedAt: daysAgo(3),
          reopenCount: 1,
        })
      ),
    })
    expect(plan.upserts[0].reopenCount).toBe(2)
  })

  it("treats exactly 30 days as a bounce-back but 31 days as a fresh OPEN episode", () => {
    const at30 = planLedgerCommit({
      fleetId: "MTL41",
      scanId: 7,
      now: NOW,
      activeFaults: [activeFault()],
      existing: map(entry({ ledgerStatus: "CLEARED", clearedAt: daysAgo(30) })),
    })
    expect(at30.bounceBackKeys.has(KEY)).toBe(true)

    const at31 = planLedgerCommit({
      fleetId: "MTL41",
      scanId: 7,
      now: NOW,
      activeFaults: [activeFault()],
      existing: map(
        entry({ ledgerStatus: "CLEARED", clearedAt: daysAgo(31), reopenCount: 0 })
      ),
    })
    expect(at31.bounceBackKeys.size).toBe(0)
    expect(at31.upserts[0]).toMatchObject({
      ledgerStatus: "OPEN",
      reopenCount: 0,
      lastReopenedAt: null,
      firstSeenScanId: 7,
      firstSeenAt: NOW,
    })
  })

  it("never flags an approved exception as a bounce-back", () => {
    const plan = planLedgerCommit({
      fleetId: "MTL41",
      scanId: 7,
      now: NOW,
      activeFaults: [activeFault(KEY, true)],
      existing: map(entry({ ledgerStatus: "CLEARED", clearedAt: daysAgo(2) })),
    })
    expect(plan.bounceBackKeys.size).toBe(0)
    expect(plan.upserts[0].ledgerStatus).toBe("APPROVED_EXCEPTION")
    expect(plan.upserts[0].reopenCount).toBe(0)
  })

  it("isWithinBounceBackWindow ignores rows that are not CLEARED", () => {
    expect(
      isWithinBounceBackWindow({ ledgerStatus: "OPEN", clearedAt: daysAgo(1) }, NOW)
    ).toBe(false)
    expect(
      isWithinBounceBackWindow({ ledgerStatus: "CLEARED", clearedAt: null }, NOW)
    ).toBe(false)
  })
})

describe("planLedgerCommit - other transitions", () => {
  it("creates an OPEN row for a brand-new active fault", () => {
    const plan = planLedgerCommit({
      fleetId: "MTL41",
      scanId: 5,
      now: NOW,
      activeFaults: [activeFault()],
      existing: new Map(),
    })
    expect(plan.upserts[0]).toMatchObject({
      ledgerStatus: "OPEN",
      firstSeenScanId: 5,
      lastSeenScanId: 5,
      firstSeenAt: NOW,
      reopenCount: 0,
    })
  })

  it("creates APPROVED_EXCEPTION rows for exempt codes", () => {
    const plan = planLedgerCommit({
      fleetId: "MTL41",
      scanId: 5,
      now: NOW,
      activeFaults: [activeFault("MID144|PSID23|FMI4", true)],
      existing: new Map(),
    })
    expect(plan.upserts[0].ledgerStatus).toBe("APPROVED_EXCEPTION")
  })

  it("keeps first-seen and refreshes last-seen for a persisting open fault", () => {
    const plan = planLedgerCommit({
      fleetId: "MTL41",
      scanId: 8,
      now: NOW,
      activeFaults: [activeFault()],
      existing: map(entry()),
    })
    expect(plan.upserts[0]).toMatchObject({
      ledgerStatus: "OPEN",
      firstSeenScanId: 1,
      lastSeenScanId: 8,
      lastSeenAt: NOW,
    })
  })

  it("keeps a REOPENED fault REOPENED while it persists", () => {
    const plan = planLedgerCommit({
      fleetId: "MTL41",
      scanId: 8,
      now: NOW,
      activeFaults: [activeFault()],
      existing: map(
        entry({ ledgerStatus: "REOPENED", reopenCount: 1, lastReopenedAt: daysAgo(5) })
      ),
    })
    expect(plan.upserts[0]).toMatchObject({
      ledgerStatus: "REOPENED",
      reopenCount: 1,
      lastReopenedAt: daysAgo(5),
    })
  })

  it("marks cleared faults CLEARED with the verification scan and time", () => {
    const plan = planLedgerCommit({
      fleetId: "MTL41",
      scanId: 12,
      now: NOW,
      activeFaults: [],
      clearedFaults: [activeFault()],
      existing: map(entry({ reopenCount: 1 })),
    })
    expect(plan.upserts[0]).toMatchObject({
      ledgerStatus: "CLEARED",
      clearedScanId: 12,
      clearedAt: NOW,
      reopenCount: 1,
      firstSeenScanId: 1,
    })
  })

  it("a fault cleared and re-detected in the same plan is not double counted", () => {
    const plan = planLedgerCommit({
      fleetId: "MTL41",
      scanId: 12,
      now: NOW,
      activeFaults: [activeFault("MID144|PPID3|FMI4")],
      clearedFaults: [activeFault()],
      existing: map(entry()),
    })
    expect(plan.upserts.map((u) => u.canonicalKey).sort()).toEqual(
      [KEY, "MID144|PPID3|FMI4"].sort()
    )
  })
})

describe("ledgerDaysOpen", () => {
  it("counts first seen -> now for an OPEN fault", () => {
    expect(ledgerDaysOpen(entry({ firstSeenAt: daysAgo(12) }), NOW)).toBe(12)
  })
  it("counts first seen -> cleared for a CLEARED fault", () => {
    expect(
      ledgerDaysOpen(
        entry({
          ledgerStatus: "CLEARED",
          firstSeenAt: daysAgo(20),
          clearedAt: daysAgo(15),
        }),
        NOW
      )
    ).toBe(5)
  })
  it("counts since the last reopen for a REOPENED fault", () => {
    expect(
      ledgerDaysOpen(
        entry({
          ledgerStatus: "REOPENED",
          firstSeenAt: daysAgo(60),
          lastReopenedAt: daysAgo(4),
        }),
        NOW
      )
    ).toBe(4)
  })
})
