import { describe, expect, it } from "vitest"

import {
  AWAITING_VERIFICATION_TEXT,
  ALL_CLEARED_TEXT,
  NONE_CLEARED_TEXT,
  buildPttReportData,
  formatStatusPill,
  ledgerDaysOpenForReport,
  pttReportFileName,
  type PttReportInput,
  type PttReportLedgerRow,
} from "./report-data"
import {
  FLEET_EXCEPTIONS,
  baselineOnlyCase,
  closedCase,
  mtl41Case,
  scanFault,
} from "./report-fixtures"

const NOW = new Date(2026, 10, 26, 12, 0)

function input(
  sessions: PttReportInput["sessions"],
  ledger: PttReportInput["ledger"] = []
): PttReportInput {
  return { sessions, ledger, exceptions: FLEET_EXCEPTIONS }
}

function truckOf(data: ReturnType<typeof buildPttReportData>, fleetId: string) {
  const truck = data.trucks.find((t) => t.fleetId === fleetId)
  if (!truck) throw new Error(`No truck ${fleetId} in the report`)
  return truck
}

describe("buildPttReportData - MTL41 (FH V3) before / after", () => {
  const data = buildPttReportData(input([mtl41Case()]), undefined, NOW)
  const truck = truckOf(data, "MTL41")

  it("lists the 4 cleared MID128 faults as `Code \u2014 Description`", () => {
    expect(truck.clearedCount).toBe(4)
    expect(truck.clearedFaultCodes).toHaveLength(4)
    expect(truck.clearedFaultCodes).toEqual(
      expect.arrayContaining([
        "MID128 PID94 FMI5 \u2014 Fuel Delivery Pressure",
        "MID128 PID175 FMI5 \u2014 Engine Oil Temperature",
        "MID128 PID153 FMI5 \u2014 Crankcase Pressure",
        "MID128 SID18 FMI5 \u2014 Water-in-Fuel Drain Valve",
      ])
    )
  })

  it("pins the single new regression first with the [NEW REGRESSION] tag", () => {
    expect(truck.newRegressionsCount).toBe(1)
    expect(truck.outstandingFaultCodes[0]).toBe(
      "[NEW REGRESSION] MID128 PID26 FMI3 \u2014 Exhaust Brake Pressure"
    )
  })

  it("counts 5 outstanding (1 regression + 4 persisting) and 9 exceptions", () => {
    expect(truck.outstandingCount).toBe(5)
    expect(truck.outstandingFaultCodes).toHaveLength(5)
    expect(truck.approvedExceptionsCount).toBe(9)
    expect(truck.approvedExceptionsNote).toBe("+9 approved exceptions excluded")
  })

  it("sorts persisting open faults by severity, then ECU / code", () => {
    expect(truck.outstandingFaultCodes.slice(1)).toEqual([
      "MID128 PID84 FMI9 \u2014 Road Speed (Engine ECU)",
      "MID144 PID84 FMI2 \u2014 Road Speed (Vehicle ECU)",
      "MID140 PSID210 FMI12 \u2014 Lighting Control Module Offline",
      "MID144 PPID3 FMI4 \u2014 Starter Output",
    ])
  })

  it("never leaks an approved exception into the outstanding list", () => {
    const exceptionKeys = new Set(
      FLEET_EXCEPTIONS.map((rule) => rule.canonicalKey.split("|").join(" "))
    )
    for (const line of truck.outstandingFaultCodes) {
      for (const key of exceptionKeys) expect(line).not.toContain(key)
    }
    expect(
      truck.outstandingItems.every((item) => item.status !== "APPROVED_EXCEPTION")
    ).toBe(true)
  })

  it("exposes the forensic audit, directive and case status", () => {
    expect(truck.caseStatusLabel).toBe("PARTIAL / BLOCKED")
    expect(truck.isVerified).toBe(true)
    expect(truck.baselineDate).toBe("2026-11-20")
    expect(truck.lastVerifiedDate).toBe("2026-11-24")
    expect(truck.collateralDamageAnalysis).toContain("COLLATERAL-TEXT")
    expect(truck.nextFloorActions).toHaveLength(2)
    expect(truck.partsWarning).toContain("PARTS-WARNING-TEXT")
    expect(truck.overallSeverity).toBe("CRITICAL")
  })

  it("computes the shared KPIs from the filtered dataset", () => {
    expect(data.kpis).toEqual({
      trucksCount: 1,
      openOrBlockedCount: 1,
      verifiedClosedCount: 0,
      actionableCriticalCount: 2,
      calibrationOnlyCount: 0,
      verifiedClearedCount: 4,
      outstandingActionableCount: 5,
      newRegressionsCount: 1,
      approvedExceptionsCount: 9,
      // 4 cleared vs 2 persisting blocking faults on the first re-scan.
      firstTimeFixRatePct: 66.7,
    })
  })

  it("keeps the Fault Register in step with the truck lists", () => {
    const byStatus = (status: string) =>
      data.faultRows.filter((row) => row.status === status).length
    expect(byStatus("CLEARED")).toBe(4)
    expect(byStatus("NEW_REGRESSION")).toBe(1)
    expect(byStatus("STILL_OPEN")).toBe(4)
    // Approved exceptions are excluded by default (but counted).
    expect(byStatus("APPROVED_EXCEPTION")).toBe(0)
    expect(data.excludedExceptionRows).toBe(9)
    expect(data.faultRows[0].status).toBe("NEW_REGRESSION")
  })

  it("keeps exception rows when excludeApprovedExceptions is false", () => {
    const included = buildPttReportData(
      input([mtl41Case()]),
      { excludeApprovedExceptions: false },
      NOW
    )
    expect(
      included.faultRows.filter((row) => row.status === "APPROVED_EXCEPTION")
    ).toHaveLength(9)
    expect(included.excludedExceptionRows).toBe(0)
    // The truck-level numbers and lists do not depend on the toggle.
    expect(included.kpis).toEqual(data.kpis)
    expect(truckOf(included, "MTL41").outstandingFaultCodes).toEqual(
      truck.outstandingFaultCodes
    )
  })
})

describe("buildPttReportData - repeat (bounce-back) tagging", () => {
  it("tags a fault with ledger reopenCount >= 1 as [REPEAT xN]", () => {
    const ledger: PttReportLedgerRow[] = [
      {
        fleetId: "MTL41",
        canonicalKey: "MID144|PID84|FMI2",
        ecuLabel: "MID 144",
        description: "Road Speed (Vehicle ECU)",
        latestSeverity: "CRITICAL",
        ledgerStatus: "REOPENED",
        firstSeenAt: new Date(2026, 9, 1),
        lastSeenAt: new Date(2026, 10, 24),
        clearedAt: null,
        reopenCount: 2,
        lastReopenedAt: new Date(2026, 10, 24),
      },
    ]
    const truck = truckOf(
      buildPttReportData(input([mtl41Case()], ledger), undefined, NOW),
      "MTL41"
    )
    expect(truck.outstandingFaultCodes).toContain(
      "[REPEAT x2] MID144 PID84 FMI2 \u2014 Road Speed (Vehicle ECU)"
    )
    const repeatItem = truck.outstandingItems.find(
      (item) => item.canonicalKey === "MID144|PID84|FMI2"
    )
    expect(repeatItem && formatStatusPill(repeatItem)).toBe("Repeat x2")
  })

  it("tags a stored bounce-back flag even without a ledger row", () => {
    const base = mtl41Case()
    const scan = base.verificationScans[0]
    const bounced = {
      ...base,
      verificationScans: [
        {
          ...scan,
          scanFaults: scan.scanFaults.map((fault) =>
            fault.canonicalKey === "MID128|PID26|FMI3"
              ? { ...fault, isBounceBack: true }
              : fault
          ),
        },
      ],
    }
    const truck = truckOf(
      buildPttReportData(input([bounced]), undefined, NOW),
      "MTL41"
    )
    expect(truck.outstandingFaultCodes[0]).toMatch(
      /^\[NEW REGRESSION\] \[REPEAT x1\] MID128 PID26 FMI3 \u2014 /
    )
  })
})

describe("buildPttReportData - baseline-only truck", () => {
  // MID128 PID94 FMI5 is stored MONITOR on purpose: the engine re-tiers it.
  const session = baselineOnlyCase([
    "MID128|PID94|FMI5",
    "MID128|SID18|FMI5",
    "MID144|PSID23|FMI4", // FH V3 fleet exception (manual air dryer)
  ])
  session.faults = session.faults.map((fault) =>
    fault.faultCode === "PID 94 FMI 5" ? { ...fault, severity: "MONITOR" } : fault
  )
  const data = buildPttReportData(input([session]), undefined, NOW)
  const truck = truckOf(data, "MTL07")

  it("shows 'Awaiting verification scan' and a zero cleared count", () => {
    expect(truck.isVerified).toBe(false)
    expect(truck.clearedCount).toBe(0)
    expect(truck.clearedFaultCodes).toEqual([AWAITING_VERIFICATION_TEXT])
    expect(truck.lastVerifiedDate).toBe("")
    expect(truck.verdictHeadline).toBe("")
    expect(truck.caseStatusLabel).toBe("OPEN")
  })

  it("lists the actionable baseline faults, re-tiered by the severity engine", () => {
    expect(truck.outstandingFaultCodes).toEqual([
      "MID128 PID94 FMI5 \u2014 Fuel Delivery Pressure",
      "MID128 SID18 FMI5 \u2014 Water-in-Fuel Drain Valve",
    ])
    expect(truck.outstandingItems[0].severity).toBe("CRITICAL")
    expect(truck.outstandingCount).toBe(2)
  })

  it("separates the approved exception cleanly", () => {
    expect(truck.approvedExceptionsCount).toBe(1)
    expect(truck.approvedExceptionsNote).toBe("+1 approved exception excluded")
    expect(truck.outstandingFaultCodes.join("\n")).not.toContain("PSID23")
    const exceptionRow = truck.faults.find((f) => f.canonicalKey === "MID144|PSID23|FMI4")
    expect(exceptionRow?.status).toBe("APPROVED_EXCEPTION")
    expect(exceptionRow?.intervention).toContain("Manual air dryer conversion")
  })
})

describe("buildPttReportData - verified truck states", () => {
  it("shows 'None \u2014 All actionable faults cleared' for a closed truck", () => {
    const data = buildPttReportData(
      input([closedCase(["MID128|PID94|FMI5", "MID128|PID175|FMI5"])]),
      { scope: "LATEST_ALL" },
      NOW
    )
    const truck = truckOf(data, "MTL02")
    expect(truck.caseStatusLabel).toBe("VERIFIED CLOSED")
    expect(truck.outstandingCount).toBe(0)
    expect(truck.outstandingFaultCodes).toEqual([ALL_CLEARED_TEXT])
    expect(truck.clearedCount).toBe(2)
    expect(data.kpis.verifiedClosedCount).toBe(1)
    expect(data.kpis.firstTimeFixRatePct).toBe(100)
  })

  it("excludes closed trucks from the default LATEST_OPEN scope", () => {
    const data = buildPttReportData(
      input([closedCase(["MID128|PID94|FMI5"]), baselineOnlyCase(["MID128|PID94|FMI5"])]),
      undefined,
      NOW
    )
    expect(data.trucks.map((t) => t.fleetId)).toEqual(["MTL07"])
  })

  it("shows 'None cleared yet' when verified with nothing cleared", () => {
    const keys = ["MID144|PID84|FMI2"]
    const noProgress = baselineOnlyCase(keys, {
      id: 30,
      fleetId: "MTL30",
      status: "IN_PROGRESS",
      caseStatus: "REJECTED_NO_PROGRESS",
      verificationScans: [
        {
          id: 31,
          scannedAt: new Date(2026, 10, 25, 10, 0),
          caseStatus: "REJECTED_NO_PROGRESS",
          verificationAudit: null,
          scanFaults: [
            scanFault("MID144|PID84|FMI2", {
              reconciliationBucket: "PERSISTING_OPEN",
              severity: "CRITICAL",
            }),
          ],
        },
      ],
    })
    const truck = truckOf(
      buildPttReportData(input([noProgress]), undefined, NOW),
      "MTL30"
    )
    expect(truck.caseStatusLabel).toBe("NO PROGRESS")
    expect(truck.clearedFaultCodes).toEqual([NONE_CLEARED_TEXT])
    expect(truck.clearedCount).toBe(0)
    expect(truck.outstandingCount).toBe(1)
  })
})

describe("buildPttReportData - filters", () => {
  const sessions = [
    mtl41Case(),
    baselineOnlyCase(["MID128|PID94|FMI5", "MID144|PPID3|FMI4"]),
  ]

  it("filters by truck", () => {
    const data = buildPttReportData(input(sessions), { fleetId: "mtl07" }, NOW)
    expect(data.trucks.map((t) => t.fleetId)).toEqual(["MTL07"])
  })

  it("filters faults by severity everywhere", () => {
    const data = buildPttReportData(
      input(sessions),
      { severities: ["CRITICAL"] },
      NOW
    )
    expect(data.faultRows.every((row) => row.severity === "CRITICAL")).toBe(true)
    const mtl41 = truckOf(data, "MTL41")
    // The MONITOR regression and persisting MONITOR faults drop out.
    expect(mtl41.newRegressionsCount).toBe(0)
    expect(mtl41.outstandingCount).toBe(2)
    expect(data.kpis.newRegressionsCount).toBe(0)
  })

  it("filters on the latest scan date", () => {
    const data = buildPttReportData(
      input(sessions),
      { fromDate: "2026-11-25" },
      NOW
    )
    // MTL41's latest scan is the 24 Nov re-scan.
    expect(data.trucks.map((t) => t.fleetId)).toEqual(["MTL07"])
  })

  it("filters by case status", () => {
    const data = buildPttReportData(
      input(sessions),
      { caseStatuses: ["PARTIAL_BLOCKED"] },
      NOW
    )
    expect(data.trucks.map((t) => t.fleetId)).toEqual(["MTL41"])
  })

  it("keeps every historical case with the ALL_SCANS scope", () => {
    const older = baselineOnlyCase(["MID128|PID94|FMI5"], {
      id: 5,
      fleetId: "MTL07",
      scannedAt: new Date(2026, 9, 1),
    })
    const data = buildPttReportData(
      input([...sessions, older]),
      { scope: "ALL_SCANS", fleetId: "MTL07" },
      NOW
    )
    expect(data.trucks).toHaveLength(2)
  })
})

describe("Truck Fault Ledger rows", () => {
  const ledgerRow = (
    overrides: Partial<PttReportLedgerRow> &
      Pick<PttReportLedgerRow, "fleetId" | "canonicalKey" | "ledgerStatus">
  ): PttReportLedgerRow => ({
    ecuLabel: "MID 128",
    description: "Some fault",
    latestSeverity: "CRITICAL",
    firstSeenAt: new Date(2026, 10, 16, 8, 0),
    lastSeenAt: new Date(2026, 10, 25, 8, 0),
    clearedAt: null,
    reopenCount: 0,
    lastReopenedAt: null,
    ...overrides,
  })

  it("computes Days Open for open (to now) and cleared (to cleared date) rows", () => {
    expect(
      ledgerDaysOpenForReport(
        { firstSeenAt: new Date(2026, 10, 16, 8, 0), clearedAt: null },
        NOW
      )
    ).toBe(10)
    expect(
      ledgerDaysOpenForReport(
        {
          firstSeenAt: new Date(2026, 10, 1, 8, 0),
          clearedAt: new Date(2026, 10, 11, 9, 0),
        },
        NOW
      )
    ).toBe(10)
    // Never negative.
    expect(
      ledgerDaysOpenForReport(
        { firstSeenAt: new Date(2026, 10, 27), clearedAt: null },
        NOW
      )
    ).toBe(0)
  })

  it("sorts by fleet, then REOPENED > OPEN > CLEARED > APPROVED_EXCEPTION, then Days Open desc", () => {
    const ledger: PttReportLedgerRow[] = [
      ledgerRow({ fleetId: "MTL10", canonicalKey: "MID128|PID1|FMI1", ledgerStatus: "OPEN" }),
      ledgerRow({
        fleetId: "MTL2",
        canonicalKey: "MID128|PID2|FMI1",
        ledgerStatus: "CLEARED",
        clearedAt: new Date(2026, 10, 20, 12, 0),
      }),
      ledgerRow({
        fleetId: "MTL2",
        canonicalKey: "MID128|PID3|FMI1",
        ledgerStatus: "APPROVED_EXCEPTION",
      }),
      ledgerRow({
        fleetId: "MTL2",
        canonicalKey: "MID128|PID4|FMI1",
        ledgerStatus: "OPEN",
        firstSeenAt: new Date(2026, 10, 25),
      }),
      ledgerRow({
        fleetId: "MTL2",
        canonicalKey: "MID128|PID5|FMI1",
        ledgerStatus: "OPEN",
        firstSeenAt: new Date(2026, 10, 1),
      }),
      ledgerRow({
        fleetId: "MTL2",
        canonicalKey: "MID128|PID6|FMI1",
        ledgerStatus: "REOPENED",
        reopenCount: 1,
        lastReopenedAt: new Date(2026, 10, 24),
        firstSeenAt: new Date(2026, 10, 20),
      }),
    ]
    const data = buildPttReportData(input([], ledger), undefined, NOW)
    expect(
      data.ledgerRows.map((row) => `${row.fleetId}:${row.ledgerStatus}:${row.daysOpen}`)
    ).toEqual([
      "MTL2:REOPENED:6",
      "MTL2:OPEN:25",
      "MTL2:OPEN:1",
      "MTL2:CLEARED:4",
      "MTL2:APPROVED_EXCEPTION:10",
      "MTL10:OPEN:10",
    ])
    const cleared = data.ledgerRows.find((row) => row.ledgerStatus === "CLEARED")
    expect(cleared?.clearedDate).toBe("2026-11-20")
    expect(data.ledgerRows[0].lastReopenedDate).toBe("2026-11-24")
    expect(data.ledgerRows[1].lastReopenedDate).toBe("")
  })

  it("scopes the ledger to the selected truck", () => {
    const ledger = [
      ledgerRow({ fleetId: "MTL2", canonicalKey: "MID128|PID2|FMI1", ledgerStatus: "OPEN" }),
      ledgerRow({ fleetId: "MTL10", canonicalKey: "MID128|PID1|FMI1", ledgerStatus: "OPEN" }),
    ]
    const all = buildPttReportData(input([], ledger), undefined, NOW)
    expect(all.ledgerRows).toHaveLength(2)
    const one = buildPttReportData(input([], ledger), { fleetId: "MTL10" }, NOW)
    expect(one.ledgerRows.map((row) => row.fleetId)).toEqual(["MTL10"])
  })
})

describe("pttReportFileName", () => {
  it("names the three files per the export spec", () => {
    const day = new Date(2026, 10, 26)
    expect(pttReportFileName("FAULT_PDF", "LATEST_OPEN", day)).toBe(
      "Miloto_PTT_Fault_Report_Latest_Open_2026-11-26.pdf"
    )
    expect(pttReportFileName("EXECUTIVE_PDF", "ALL_SCANS", day)).toBe(
      "Miloto_PTT_Executive_Directives_All_Scans_2026-11-26.pdf"
    )
    expect(pttReportFileName("EXCEL", "LATEST_ALL", day)).toBe(
      "Miloto_PTT_Diagnostics_Latest_All_2026-11-26.xlsx"
    )
  })
})
