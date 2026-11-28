import { describe, expect, it, vi } from "vitest"

import {
  buildPttReportData,
  describePttReportFilters,
  resolvePttReportOptions,
  sessionMatchesDateRange,
  type PttReportCase,
  type PttReportInput,
} from "./report-data"
import {
  planReconcileExistingCase,
  type CaseSessionState,
  type StoredFaultRow,
} from "./reconcile-existing-plan"
import { buildPttWorkbook } from "./report-excel"
import { buildExecutiveDirectivesPdf, buildFaultReportPdf } from "./report-pdf"
import {
  FLEET_EXCEPTIONS,
  baselineOnlyCase,
  mtl41Case,
  scanFault,
} from "./report-fixtures"

const NOW = new Date(2026, 10, 28, 12, 0)

// ---------------------------------------------------------------------------
// Fixtures: a truck baselined on the 27th and an older truck baselined on the
// 24th whose only 27 Nov event is its after-scan (NO PROGRESS).
// ---------------------------------------------------------------------------

const KEY = "MID128|PID94|FMI5"

const baselinedOn27th = (): PttReportCase =>
  baselineOnlyCase([KEY], {
    id: 100,
    fleetId: "MTL07",
    scannedAt: new Date(2026, 10, 27, 7, 0),
  })

const baselinedOn24thVerifiedOn27th = (): PttReportCase =>
  baselineOnlyCase([KEY], {
    id: 200,
    fleetId: "MTL30",
    status: "IN_PROGRESS",
    caseStatus: "REJECTED_NO_PROGRESS",
    scannedAt: new Date(2026, 10, 24, 7, 0),
    verifiedAt: new Date(2026, 10, 27, 10, 0),
    verificationScans: [
      {
        id: 201,
        scannedAt: new Date(2026, 10, 27, 10, 0),
        caseStatus: "REJECTED_NO_PROGRESS",
        verificationAudit: null,
        scanFaults: [
          scanFault(KEY, { reconciliationBucket: "PERSISTING_OPEN" }),
        ],
      },
    ],
  })

function input(sessions: readonly PttReportCase[]): PttReportInput {
  return { sessions, ledger: [], exceptions: FLEET_EXCEPTIONS }
}

const RANGE = { fromDate: "2026-11-27", toDate: "2026-11-28" } as const

const fleetIds = (data: ReturnType<typeof buildPttReportData>) =>
  data.trucks.map((truck) => truck.fleetId).sort()

describe("date range: BASELINE_DATE (default) vs ANY_ACTIVITY", () => {
  const sessions = [baselinedOn27th(), baselinedOn24thVerifiedOn27th()]

  it("defaults to BASELINE_DATE", () => {
    expect(resolvePttReportOptions().dateBasis).toBe("BASELINE_DATE")
    expect(resolvePttReportOptions({ ...RANGE }).dateBasis).toBe(
      "BASELINE_DATE"
    )
  })

  it("returns only the truck baselined in the range by default", () => {
    const data = buildPttReportData(input(sessions), { ...RANGE }, NOW)
    expect(fleetIds(data)).toEqual(["MTL07"])
  })

  it("returns only the baselined truck with an explicit BASELINE_DATE too", () => {
    const data = buildPttReportData(
      input(sessions),
      { ...RANGE, dateBasis: "BASELINE_DATE" },
      NOW
    )
    expect(fleetIds(data)).toEqual(["MTL07"])
  })

  it("returns both trucks with ANY_ACTIVITY", () => {
    const data = buildPttReportData(
      input(sessions),
      { ...RANGE, dateBasis: "ANY_ACTIVITY" },
      NOW
    )
    expect(fleetIds(data)).toEqual(["MTL07", "MTL30"])
    const verified = data.trucks.find((truck) => truck.fleetId === "MTL30")
    expect(verified?.baselineDate).toBe("2026-11-24")
    expect(verified?.caseStatusLabel).toBe("NO PROGRESS")
  })

  it("applies to every scope", () => {
    for (const scope of ["LATEST_OPEN", "LATEST_ALL", "ALL_SCANS"] as const) {
      const data = buildPttReportData(
        input(sessions),
        { ...RANGE, scope },
        NOW
      )
      expect(fleetIds(data)).toEqual(["MTL07"])
    }
  })

  it("feeds the fault rows (Fault Report + Fault Register) the same cases", () => {
    const baseline = buildPttReportData(input(sessions), { ...RANGE }, NOW)
    expect(baseline.faultRows.map((row) => row.fleetId)).toEqual(["MTL07"])
    const any = buildPttReportData(
      input(sessions),
      { ...RANGE, dateBasis: "ANY_ACTIVITY" },
      NOW
    )
    expect(any.faultRows.map((row) => row.fleetId).sort()).toEqual([
      "MTL07",
      "MTL30",
    ])
  })

  it("never matches a case on a later re-reconcile alone (updatedAt is not a date)", () => {
    // Baselined and verified on the 24th; only a background re-reconcile
    // touched it on the 27th, which the report data cannot even see.
    const reReconciled = baselineOnlyCase([KEY], {
      id: 300,
      fleetId: "MTL55",
      caseStatus: "REJECTED_NO_PROGRESS",
      scannedAt: new Date(2026, 10, 24, 7, 0),
      verificationScans: [
        {
          id: 301,
          scannedAt: new Date(2026, 10, 24, 15, 0),
          caseStatus: "REJECTED_NO_PROGRESS",
          verificationAudit: null,
          scanFaults: [
            scanFault(KEY, { reconciliationBucket: "PERSISTING_OPEN" }),
          ],
        },
      ],
    })
    for (const dateBasis of ["BASELINE_DATE", "ANY_ACTIVITY"] as const) {
      const data = buildPttReportData(
        input([reReconciled]),
        { ...RANGE, dateBasis },
        NOW
      )
      expect(data.trucks).toHaveLength(0)
    }
  })

  it("treats both day boundaries as inclusive", () => {
    const late = baselineOnlyCase([KEY], {
      scannedAt: new Date(2026, 10, 28, 23, 59, 59),
    })
    const early = baselineOnlyCase([KEY], {
      scannedAt: new Date(2026, 10, 27, 0, 0, 0),
    })
    const before = baselineOnlyCase([KEY], {
      scannedAt: new Date(2026, 10, 26, 23, 59, 59),
    })
    const after = baselineOnlyCase([KEY], {
      scannedAt: new Date(2026, 10, 29, 0, 0, 0),
    })
    const matches = (session: PttReportCase) =>
      sessionMatchesDateRange(
        session,
        "BASELINE_DATE",
        RANGE.fromDate,
        RANGE.toDate
      )
    expect(matches(late)).toBe(true)
    expect(matches(early)).toBe(true)
    expect(matches(before)).toBe(false)
    expect(matches(after)).toBe(false)
  })

  it("uses a legacy case's verifiedAt as its after-scan date for ANY_ACTIVITY", () => {
    const legacy = baselineOnlyCase([KEY], {
      scannedAt: new Date(2026, 10, 20, 7, 0),
      verifiedAt: new Date(2026, 10, 27, 9, 0),
      verificationSummary: { legacy: true },
    })
    expect(
      sessionMatchesDateRange(legacy, "BASELINE_DATE", "2026-11-27", "2026-11-28")
    ).toBe(false)
    expect(
      sessionMatchesDateRange(legacy, "ANY_ACTIVITY", "2026-11-27", "2026-11-28")
    ).toBe(true)
  })

  it("matches nothing extra without a date range", () => {
    const data = buildPttReportData(input(sessions), undefined, NOW)
    expect(fleetIds(data)).toEqual(["MTL07", "MTL30"])
  })
})

describe("report header lines reflect the date mode and exception mode", () => {
  it("prints `Baseline date:` by default and `Activity date:` for ANY_ACTIVITY", () => {
    const baseline = describePttReportFilters(
      resolvePttReportOptions({ ...RANGE })
    ).join("\n")
    expect(baseline).toContain(
      "Baseline date: 27 Nov 2026 to 28 Nov 2026"
    )
    expect(baseline).not.toContain("Activity date")

    const activity = describePttReportFilters(
      resolvePttReportOptions({ ...RANGE, dateBasis: "ANY_ACTIVITY" })
    ).join("\n")
    expect(activity).toContain("Activity date: 27 Nov 2026 to 28 Nov 2026")
    expect(activity).not.toContain("Baseline date")
  })

  it("prints no date line without a range", () => {
    const text = describePttReportFilters(resolvePttReportOptions()).join("\n")
    expect(text).not.toContain("Baseline date")
    expect(text).not.toContain("Activity date")
  })

  const pdfSource = (buffer: ArrayBuffer) =>
    Buffer.from(buffer).toString("latin1")

  it("carries the date mode into both PDFs and the workbook properties", async () => {
    const data = buildPttReportData(
      input([baselinedOn27th(), baselinedOn24thVerifiedOn27th()]),
      { ...RANGE, dateBasis: "ANY_ACTIVITY" },
      NOW
    )
    for (const pdf of [
      buildFaultReportPdf(data),
      buildExecutiveDirectivesPdf(data),
    ]) {
      expect(pdfSource(pdf.buffer)).toContain(
        "Activity date: 27 Nov 2026 to 28 Nov 2026"
      )
    }
    const workbook = await buildPttWorkbook(data)
    expect(workbook.description).toContain(
      "Activity date: 27 Nov 2026 to 28 Nov 2026"
    )
  })
})

describe("Executive Directives header: approved exceptions text is truthful", () => {
  const sessions = [mtl41Case()]

  it("prints `excluded` (never `included`) when exceptions are excluded", () => {
    const data = buildPttReportData(
      input(sessions),
      { excludeApprovedExceptions: true },
      NOW
    )
    const truck = data.trucks[0]
    expect(truck.approvedExceptionsNote).toBe(
      "+9 approved exceptions excluded"
    )
    expect(truck.approvedExceptionLines).toEqual([])

    const source = pdfText(buildExecutiveDirectivesPdf(data).buffer)
    expect(source).toContain("Approved exceptions: excluded")
    expect(source).not.toContain("Approved exceptions: included")
  })

  it("excludes them by default", () => {
    const data = buildPttReportData(input(sessions), undefined, NOW)
    const source = pdfText(buildExecutiveDirectivesPdf(data).buffer)
    expect(source).toContain("Approved exceptions: excluded")
    expect(source).not.toContain("Approved exceptions: included")
  })

  it("prints them (and says `included`) only when they are really printed", () => {
    const data = buildPttReportData(
      input(sessions),
      { excludeApprovedExceptions: false },
      NOW
    )
    const truck = data.trucks[0]
    expect(truck.approvedExceptionsNote).toBeNull()
    expect(truck.approvedExceptionLines).toHaveLength(9)
    // They stay out of the outstanding list and its count.
    expect(truck.outstandingCount).toBe(truck.outstandingItems.length)

    const source = pdfText(buildExecutiveDirectivesPdf(data).buffer)
    expect(source).toContain("Approved exceptions: included")
    expect(source).not.toContain("Approved exceptions: excluded")
    expect(source).not.toContain("approved exceptions excluded")
  })

  it("keeps the Fault Report header on the same boolean", () => {
    for (const excludeApprovedExceptions of [true, false]) {
      const data = buildPttReportData(
        input(sessions),
        { excludeApprovedExceptions },
        NOW
      )
      const source = pdfText(buildFaultReportPdf(data).buffer)
      expect(source).toContain(
        `Approved exceptions: ${excludeApprovedExceptions ? "excluded" : "included"}`
      )
    }
  })

  function pdfText(buffer: ArrayBuffer): string {
    return Buffer.from(buffer).toString("latin1")
  }
})

// ---------------------------------------------------------------------------
// Re-reconcile never rewrites history
// ---------------------------------------------------------------------------

describe("planReconcileExistingCase keeps the original scan dates", () => {
  const BASELINE_AT = new Date("2026-11-24T07:00:00Z")
  const VERIFICATION_AT = new Date("2026-11-27T10:00:00Z")
  const RERUN_AT = new Date("2026-11-28T09:30:00Z")

  const row = (overrides: Partial<StoredFaultRow> = {}): StoredFaultRow => ({
    id: 1,
    canonicalKey: "EMS|P111D00",
    ecuLabel: "Engine Control Module (EMS)",
    dtcRaw: "P111D00",
    description: "",
    pttStatus: "ACTIVE",
    severity: "CRITICAL",
    reconciliationBucket: null,
    isBounceBack: false,
    isApprovedException: false,
    isExtracted: true,
    keyNeedsReview: false,
    keyReviewReason: null,
    ...overrides,
  })

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

  const plan = (session: CaseSessionState) =>
    planReconcileExistingCase({
      fleetId: "MTL121",
      generation: "FH_V4",
      baselineScanId: 1,
      baselineScannedAt: BASELINE_AT,
      verificationScanId: 2,
      baselineRows: [row()],
      // The fault is gone on the after-scan: the case closes cleanly.
      verificationRows: [],
      exceptions: [],
      ledger: new Map(),
      session,
      verificationScannedAt: VERIFICATION_AT,
    })

  const everyDate = (value: unknown): Date[] => {
    if (value instanceof Date) return [value]
    if (Array.isArray(value)) return value.flatMap(everyDate)
    if (value instanceof Map) return [...value.values()].flatMap(everyDate)
    if (value && typeof value === "object") {
      return Object.values(value).flatMap(everyDate)
    }
    return []
  }

  it("dates a first-time closure by the verification photos, not the re-run", () => {
    // The re-run happens "now": install a clock to prove it is never read.
    vi.useFakeTimers()
    vi.setSystemTime(RERUN_AT)
    try {
      const result = plan(openSession)
      expect(result.session.caseStatus).toBe("VERIFIED_CLOSED")
      expect(result.session.verifiedAt).toEqual(VERIFICATION_AT)
      expect(result.session.closedAt).toEqual(VERIFICATION_AT)

      // No date anywhere in the plan (session, ledger, ...) is the re-run time.
      const dates = everyDate(result)
      expect(dates.length).toBeGreaterThan(0)
      expect(dates.some((date) => date.getTime() === RERUN_AT.getTime())).toBe(
        false
      )
      // Ledger history is anchored to the stored scans.
      for (const entry of result.ledgerUpserts) {
        expect([BASELINE_AT.getTime(), VERIFICATION_AT.getTime()]).toContain(
          entry.firstSeenAt.getTime()
        )
        expect(entry.lastSeenAt.getTime()).toBeLessThanOrEqual(
          VERIFICATION_AT.getTime()
        )
        if (entry.clearedAt) {
          expect(entry.clearedAt).toEqual(VERIFICATION_AT)
        }
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it("never overwrites an existing verifiedAt / closedAt", () => {
    const originalVerifiedAt = new Date("2026-11-25T08:00:00Z")
    const originalClosedAt = new Date("2026-11-25T08:05:00Z")
    const result = plan({
      ...openSession,
      caseStatus: "VERIFIED_CLOSED",
      workflowStatus: "VERIFIED_CLOSED",
      verifiedAt: originalVerifiedAt,
      closureMode: "CLEAN",
      closedAt: originalClosedAt,
    })
    expect(result.session.verifiedAt).toEqual(originalVerifiedAt)
    expect(result.session.closedAt).toEqual(originalClosedAt)
  })

  it("has no input or output that carries the baseline scannedAt for rewriting", () => {
    // The plan only reads `baselineScannedAt` (to start missing ledger
    // history there); it emits no scan-level `scannedAt` / `createdAt`.
    const result = plan(openSession)
    expect(Object.keys(result.session)).not.toContain("scannedAt")
    expect(Object.keys(result.session)).not.toContain("createdAt")
  })
})
