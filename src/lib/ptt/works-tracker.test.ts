import { describe, expect, it } from "vitest"

import { PTT_SEVERITY_RANK } from "../ptt-diagnostics"
import type { PttReportLedgerRow } from "./report-data"
import {
  FLEET_EXCEPTIONS,
  baselineFault,
  baselineOnlyCase,
  closedCase,
  mtl41Case,
  scanFault,
} from "./report-fixtures"
import {
  WORKS_TRACKER_SHEET_HEADERS,
  WORKS_TRACKER_SHEET_NAMES,
  buildWorksTrackerWorkbook,
  buildWorksTrackerWorkbookFile,
} from "./works-tracker-excel"
import {
  buildWorksTrackerData,
  compareWorksTrackerFleetIds,
  describeWorksTrackerOrder,
  stripLeadingCodePrefix,
  type PttWorksTrackerInput,
  type PttWorksTrackerRosterTruck,
  type WorksTrackerRow,
} from "./works-tracker-data"
import {
  PTT_WORKS_TRACKER_TITLE,
  WORKS_TRACKER_COLUMN_RATIOS,
  WORKS_TRACKER_PDF_HEADERS,
  buildWorksTrackerPdf,
} from "./works-tracker-pdf"

const NOW = new Date(2026, 10, 26, 12, 0)

const ledger: PttReportLedgerRow[] = [
  {
    fleetId: "MTL41",
    canonicalKey: "MID144|PID84|FMI2",
    ecuLabel: "MID 144",
    description: "Road Speed (Vehicle ECU)",
    latestSeverity: "CRITICAL",
    ledgerStatus: "REOPENED",
    firstSeenAt: new Date(2026, 10, 1),
    lastSeenAt: new Date(2026, 10, 24),
    clearedAt: null,
    reopenCount: 1,
    lastReopenedAt: new Date(2026, 10, 24),
  },
]

const roster = (...ids: string[]): PttWorksTrackerRosterTruck[] =>
  ids.map((fleetId) => ({ fleetId, generation: "FH_V3" }))

/** PENDING MTL99 (roster only), PARTIAL MTL07, COMPLETE MTL41 + MTL02. */
function fourTruckInput(
  overrides: Partial<PttWorksTrackerInput> = {}
): PttWorksTrackerInput {
  return {
    sessions: [
      mtl41Case(),
      baselineOnlyCase(["MID128|PID94|FMI5", "MID144|PPID3|FMI4"]),
      closedCase(["MID128|PID94|FMI5"]),
    ],
    ledger,
    exceptions: FLEET_EXCEPTIONS,
    roster: [
      { fleetId: "MTL99", generation: "UNKNOWN" },
      ...roster("MTL07", "MTL41", "MTL02"),
    ],
    ...overrides,
  }
}

function rowOf(rows: readonly WorksTrackerRow[], fleetId: string): WorksTrackerRow {
  const row = rows.find((candidate) => candidate.fleetId === fleetId)
  if (!row) throw new Error(`No tracker row for ${fleetId}`)
  return row
}

describe("Works tracker data", () => {
  const data = buildWorksTrackerData(fourTruckInput(), undefined, NOW)

  it("tracks the full 4-truck scenario", () => {
    expect(data.rows).toHaveLength(4)

    const pending = rowOf(data.rows, "MTL99")
    expect(pending).toMatchObject({
      trackerStatus: "PENDING",
      closureOutcome: "Not Scanned",
      residualFaultCodes: "Pending baseline scan",
      beforePhotoDate: null,
      afterPhotoDate: null,
      turnaroundDays: null,
      openingFaultsCount: null,
      clearedFaultsCount: null,
      residualFaultsCount: null,
      clearedFaultCodes: "",
      clearedFaultItems: [],
      residualFaultItems: [],
      generation: "\u2014",
    })

    const partial = rowOf(data.rows, "MTL07")
    expect(partial).toMatchObject({
      trackerStatus: "PARTIAL",
      closureOutcome: "Fault Clearance Pending",
      residualFaultCodes: "Awaiting final photo",
      beforePhotoDate: "2026-11-25",
      afterPhotoDate: null,
      turnaroundDays: 1,
      openingFaultsCount: 2,
      clearedFaultsCount: null,
      residualFaultsCount: null,
      clearedFaultCodes: "",
      clearedFaultItems: [],
      residualFaultItems: [],
      generation: "FH V3",
    })

    const mtl41 = rowOf(data.rows, "MTL41")
    expect(mtl41).toMatchObject({
      trackerStatus: "COMPLETE",
      closureOutcome: "Residual Faults",
      clearedFaultsCount: 4,
      residualFaultsCount: 5,
      beforePhotoDate: "2026-11-20",
      afterPhotoDate: "2026-11-24",
      turnaroundDays: 4,
    })
    const residual = mtl41.residualFaultCodes.split("\n")
    expect(residual).toHaveLength(5)
    // The newly appearing fault is listed like any other residual fault.
    expect(residual.some((line) => line.startsWith("MID128 PID26 FMI3 - "))).toBe(
      true
    )
    expect(mtl41.residualFaultCodes).not.toContain("[NEW REGRESSION]")
    expect(mtl41.residualFaultCodes).toContain("MID144 PID84 FMI2 - ")
    expect(mtl41.residualFaultCodes).not.toMatch(/exception/i)
    expect(mtl41.residualFaultItems).toHaveLength(5)

    // The 4 cleared MID128 faults are listed on their own, `Code - Description`.
    const cleared = mtl41.clearedFaultCodes.split("\n")
    expect(cleared).toHaveLength(4)
    expect(mtl41.clearedFaultItems).toHaveLength(4)
    for (const line of cleared) expect(line).toMatch(/^MID128 [A-Z]+\d+ FMI5 - /)
    // ASCII hyphens only: PDF safe.
    for (const line of [...cleared, ...residual]) {
      expect(line).not.toMatch(/[\u2013\u2014]/)
    }

    const clean = rowOf(data.rows, "MTL02")
    expect(clean).toMatchObject({
      trackerStatus: "COMPLETE",
      closureOutcome: "Clean Closure",
      residualFaultCodes: "None - All actionable faults cleared",
      residualFaultsCount: 0,
      residualFaultItems: [],
      clearedFaultsCount: 1,
      turnaroundDays: 4,
    })

    // COMPLETE with nothing cleared prints "None cleared".
    const none = buildWorksTrackerData(
      {
        sessions: [
          closedCase(["MID128|PID94|FMI5"], {
            verificationScans: closedCase(["MID128|PID94|FMI5"]).verificationScans.map(
              (scan) => ({
                ...scan,
                scanFaults: scan.scanFaults.map((fault) => ({
                  ...fault,
                  pttStatus: "ACTIVE" as const,
                  reconciliationBucket: "PERSISTING_OPEN" as const,
                })),
              })
            ),
          }),
        ],
        ledger: [],
        exceptions: FLEET_EXCEPTIONS,
        roster: [],
      },
      undefined,
      NOW
    )
    expect(none.rows[0]).toMatchObject({
      clearedFaultsCount: 0,
      clearedFaultCodes: "None cleared",
      residualFaultsCount: 1,
    })
  })

  it("matches the numbers of the other reports", () => {
    expect(data.kpis).toMatchObject({
      totalFleet: 4,
      completeCount: 2,
      partialCount: 1,
      pendingCount: 1,
      cleanClosureCount: 1,
      residualFaultsTrucksCount: 1,
      totalClearedFaults: 5,
      totalResidualFaults: 5,
    })
  })

  it("sorts COMPLETE -> PARTIAL -> PENDING, then natural Fleet No.", () => {
    const rows = buildWorksTrackerData(
      {
        sessions: [
          closedCase(["MID128|PID94|FMI5"], { id: 30, fleetId: "MTL100" }),
          closedCase(["MID128|PID94|FMI5"], { id: 40, fleetId: "MTL10" }),
          baselineOnlyCase(["MID128|PID94|FMI5"], { id: 50, fleetId: "MTL200" }),
          baselineOnlyCase(["MID128|PID94|FMI5"], { id: 60, fleetId: "MTL20" }),
        ],
        ledger: [],
        exceptions: FLEET_EXCEPTIONS,
        roster: roster("MTL300", "MTL30", "MTL5"),
      },
      undefined,
      NOW
    )
    expect(rows.rows.map((row) => `${row.trackerStatus}:${row.fleetId}`)).toEqual([
      "COMPLETE:MTL10",
      "COMPLETE:MTL100",
      "PARTIAL:MTL20",
      "PARTIAL:MTL200",
      "PENDING:MTL5",
      "PENDING:MTL30",
      "PENDING:MTL300",
    ])
    expect(rows.kpis).toMatchObject({
      totalFleet: 7,
      completeCount: 2,
      completePct: 28.6,
      partialCount: 2,
      partialPct: 28.6,
      pendingCount: 3,
      pendingPct: 42.9,
    })
  })

  it("reports 0% on an empty fleet instead of dividing by zero", () => {
    const empty = buildWorksTrackerData(
      { sessions: [], ledger: [], exceptions: [], roster: [] },
      undefined,
      NOW
    )
    expect(empty.rows).toEqual([])
    expect(empty.kpis).toMatchObject({
      totalFleet: 0,
      completePct: 0,
      partialPct: 0,
      pendingPct: 0,
    })
  })

  it("never drops a scanned truck that is missing from the roster", () => {
    const result = buildWorksTrackerData(
      fourTruckInput({ roster: roster("MTL99") }),
      undefined,
      NOW
    )
    expect(result.rows.map((row) => row.fleetId).sort()).toEqual([
      "MTL02",
      "MTL07",
      "MTL41",
      "MTL99",
    ])
    // Generation comes from the scan when the roster does not know it.
    expect(rowOf(result.rows, "MTL41").generation).toBe("FH V3")
  })

  it("filters to one truck but ignores the severity filter", () => {
    const one = buildWorksTrackerData(
      fourTruckInput(),
      { fleetId: "mtl99" },
      NOW
    )
    expect(one.rows.map((row) => row.fleetId)).toEqual(["MTL99"])

    const all = buildWorksTrackerData(
      fourTruckInput(),
      { severities: ["CRITICAL"] },
      NOW
    )
    expect(all.rows).toHaveLength(4)
    expect(rowOf(all.rows, "MTL41").residualFaultsCount).toBe(5)
  })

  it("evaluates each truck inside the date window, else PENDING", () => {
    const recent = buildWorksTrackerData(
      fourTruckInput(),
      { fromDate: "2026-11-24", toDate: "2026-11-26" },
      NOW
    )
    expect(rowOf(recent.rows, "MTL41").trackerStatus).toBe("COMPLETE")
    expect(rowOf(recent.rows, "MTL07").trackerStatus).toBe("PARTIAL")
    // Baseline 18 Nov / verification 22 Nov: both before the window.
    expect(rowOf(recent.rows, "MTL02")).toMatchObject({
      trackerStatus: "PENDING",
      closureOutcome: "Not Scanned",
      beforePhotoDate: null,
    })

    // Only the baseline falls inside the window: the case still counts.
    const early = buildWorksTrackerData(
      fourTruckInput(),
      { fromDate: "2026-11-17", toDate: "2026-11-19" },
      NOW
    )
    expect(rowOf(early.rows, "MTL02").trackerStatus).toBe("COMPLETE")
    expect(rowOf(early.rows, "MTL41").trackerStatus).toBe("PENDING")
  })

  it("always silently excludes approved exceptions (count = lines)", () => {
    for (const excludeApprovedExceptions of [true, false]) {
      const result = buildWorksTrackerData(
        fourTruckInput(),
        { excludeApprovedExceptions },
        NOW
      )
      expect(result.options.excludeApprovedExceptions).toBe(true)
      const mtl41 = rowOf(result.rows, "MTL41")
      expect(mtl41.residualFaultsCount).toBe(5)
      expect(mtl41.residualFaultCodes.split("\n")).toHaveLength(5)
      expect(mtl41.residualFaultItems).toHaveLength(5)
      expect(mtl41.clearedFaultsCount).toBe(4)
      expect(mtl41.clearedFaultCodes.split("\n")).toHaveLength(4)
      expect(mtl41.clearedFaultItems).toHaveLength(4)
      expect(mtl41.residualFaultCodes).not.toMatch(/exception/i)
      // Identical output whatever the toggle says.
      expect(result.rows).toEqual(data.rows)
      expect(result.kpis).toEqual(data.kpis)
    }
  })

  it("lists residual and cleared faults by severity, then ECU, then code", () => {
    const mtl41 = rowOf(data.rows, "MTL41")
    for (const items of [mtl41.residualFaultItems, mtl41.clearedFaultItems]) {
      const sorted = [...items].sort(
        (a, b) =>
          PTT_SEVERITY_RANK[b.severity] - PTT_SEVERITY_RANK[a.severity] ||
          a.ecuLabel.localeCompare(b.ecuLabel)
      )
      // Severity and ECU order is stable; ties keep the canonical-key order.
      expect(items.map((item) => [item.severity, item.ecuLabel])).toEqual(
        sorted.map((item) => [item.severity, item.ecuLabel])
      )
    }
    const ranks = mtl41.residualFaultItems.map(
      (item) => PTT_SEVERITY_RANK[item.severity]
    )
    expect(ranks).toHaveLength(5)
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a))
    // Cleared: the CRITICAL codes come before the CALIBRATION_ONLY one.
    expect(mtl41.clearedFaultItems.map((item) => item.severity)).toEqual([
      "CRITICAL",
      "CRITICAL",
      "CRITICAL",
      "CALIBRATION_ONLY",
    ])
    expect(mtl41.residualFaultItems[0]?.text).not.toMatch(/^\[NEW REGRESSION\]/)
  })
  it("never prints regression / exception wording or the old outcome", () => {
    for (const excludeApprovedExceptions of [true, false]) {
      const result = buildWorksTrackerData(
        fourTruckInput(),
        { excludeApprovedExceptions },
        NOW
      )
      const text = JSON.stringify(
        result.rows.map((row) => [
          row.closureOutcome,
          row.clearedFaultCodes,
          row.residualFaultCodes,
        ])
      )
      for (const banned of [
        "[NEW REGRESSION]",
        "Reg ",
        "approved exception",
        "[APPROVED EXCEPTION]",
        "In Workshop",
      ]) {
        expect(text.toLowerCase()).not.toContain(banned.toLowerCase())
      }
    }
  })

  it("marks PARTIAL trucks as Fault Clearance Pending", () => {
    for (const row of data.rows.filter((r) => r.trackerStatus === "PARTIAL")) {
      expect(row.closureOutcome).toBe("Fault Clearance Pending")
    }
  })
})

/** Mixed statuses: COMPLETE MTL100 + MTL41, PARTIAL MTL10, PENDING MTL01 + MTL145. */
function mixedInput(): PttWorksTrackerInput {
  return {
    sessions: [
      closedCase(["MID128|PID94|FMI5"], { id: 30, fleetId: "MTL100" }),
      closedCase(["MID128|PID94|FMI5"], { id: 31, fleetId: "MTL41" }),
      baselineOnlyCase(["MID128|PID94|FMI5"], { id: 32, fleetId: "MTL10" }),
    ],
    ledger: [],
    exceptions: FLEET_EXCEPTIONS,
    roster: roster("MTL145", "MTL01"),
  }
}

describe("Works tracker sort order", () => {
  it("sorts by Fleet No. regardless of status", () => {
    const result = buildWorksTrackerData(
      mixedInput(),
      { sortBy: "FLEET_NO" },
      NOW
    )
    expect(result.options.sortBy).toBe("FLEET_NO")
    expect(result.rows.map((row) => row.fleetId)).toEqual([
      "MTL01",
      "MTL10",
      "MTL41",
      "MTL100",
      "MTL145",
    ])
  })

  it("defaults to status order with natural Fleet No. tie-breaking", () => {
    for (const options of [undefined, { sortBy: "STATUS" as const }]) {
      const result = buildWorksTrackerData(mixedInput(), options, NOW)
      expect(result.options.sortBy).toBe("STATUS")
      expect(
        result.rows.map((row) => `${row.trackerStatus}:${row.fleetId}`)
      ).toEqual([
        "COMPLETE:MTL41",
        "COMPLETE:MTL100",
        "PARTIAL:MTL10",
        "PENDING:MTL01",
        "PENDING:MTL145",
      ])
    }
  })

  it("compares numeric suffixes with or without leading zeros", () => {
    const ids = ["MTL145", "MTL100", "MTL41", "MTL10", "MTL09", "MTL2", "MTL01"]
    expect([...ids].sort(compareWorksTrackerFleetIds)).toEqual([
      "MTL01",
      "MTL2",
      "MTL09",
      "MTL10",
      "MTL41",
      "MTL100",
      "MTL145",
    ])
    expect(compareWorksTrackerFleetIds("MTL01", "MTL02")).toBeLessThan(0)
    expect(compareWorksTrackerFleetIds("MTL09", "MTL10")).toBeLessThan(0)
    expect(compareWorksTrackerFleetIds("MTL10", "MTL100")).toBeLessThan(0)
    // Same numeric value: deterministic, never 0 for different strings.
    expect(compareWorksTrackerFleetIds("MTL01", "MTL1")).not.toBe(0)
  })

  it("describes the active order for the header", () => {
    const byStatus = buildWorksTrackerData(mixedInput(), undefined, NOW)
    expect(describeWorksTrackerOrder(byStatus)).toBe("Order: By Status")
    const byFleet = buildWorksTrackerData(
      mixedInput(),
      { sortBy: "FLEET_NO" },
      NOW
    )
    expect(describeWorksTrackerOrder(byFleet)).toBe(
      "Order: Fleet No. (MTL01\u2013MTL145)"
    )
  })
})

// jsPDF writes uncompressed content streams, so printed text is searchable.
const pdfSource = (buffer: ArrayBuffer) => Buffer.from(buffer).toString("latin1")

describe("Works tracker PDF", () => {
  const data = buildWorksTrackerData(fourTruckInput(), undefined, NOW)
  const pdf = buildWorksTrackerPdf(data)

  it("is a valid, non-empty landscape PDF with the report title", () => {
    const source = pdfSource(pdf.buffer)
    expect(pdf.buffer.byteLength).toBeGreaterThan(1500)
    expect(source.startsWith("%PDF-")).toBe(true)
    expect(source.trimEnd().endsWith("%%EOF")).toBe(true)
    expect(source).toContain("Fleet Diagnostic Works Tracker")
    expect(pdf.title).toBe(PTT_WORKS_TRACKER_TITLE)
    expect(pdf.fileName).toBe("Miloto_PTT_Works_Tracker_2026-11-26.pdf")
    // A4 landscape: the page box is wider than it is tall.
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(source)
    expect(box).not.toBeNull()
    expect(Number(box?.[1])).toBeGreaterThan(Number(box?.[2]))
  })

  it("prints the 6 side-by-side columns, KPI strip and both fault lists", () => {
    const source = pdfSource(pdf.buffer)
    for (const label of [
      "Fleet & Gen",
      "Status & Outcome",
      "Before / After",
      "Fault Tally",
      "Cleared Faults",
      "Residual Faults",
      "Cleared: 4",
      "Residual: 5",
      `Before: ${rowOf(data.rows, "MTL41").openingFaultsCount}`,
      "Before: 2026-11-20",
      "After: 2026-11-24",
      "After: -",
      "Total Fleet",
      "Clean Closures",
      "Complete w/ Residual Faults",
      "PENDING",
      "PARTIAL",
      "COMPLETE",
      "Pending baseline scan",
      "Awaiting final photo",
      "None - All actionable faults cleared",
      "Clean Closure",
      "Fault Clearance",
      "Order: By Status",
    ]) {
      expect(source).toContain(label)
    }
    // The retired 8-column headers are gone.
    for (const old of [
      "Tracker Status",
      "Closure Outcome",
      "Closing Fault Codes",
      "Before Photo",
    ]) {
      expect(source).not.toContain(old)
    }
    expect(WORKS_TRACKER_PDF_HEADERS).toHaveLength(6)
    expect(WORKS_TRACKER_COLUMN_RATIOS).toEqual([8, 13, 11, 10, 29, 29])
    expect(WORKS_TRACKER_COLUMN_RATIOS.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it("renders both the 4 cleared and the 5 residual MTL41 faults", () => {
    const source = pdfSource(pdf.buffer)
    const mtl41 = rowOf(data.rows, "MTL41")
    expect(mtl41.clearedFaultItems).toHaveLength(4)
    expect(mtl41.residualFaultItems).toHaveLength(5)
    // jsPDF wraps long lines, so every fault is matched by its code.
    for (const key of [
      "MID128 PID153 FMI5",
      "MID128 PID175 FMI5",
      "MID128 PID94 FMI5",
      "MID128 SID18 FMI5",
    ]) {
      expect(source).toContain(key)
    }
    for (const item of [...mtl41.clearedFaultItems, ...mtl41.residualFaultItems]) {
      expect(source).toContain(item.codeLabel)
    }
    expect(source).toContain("MID128 PID26 FMI3")
    expect(source).toContain("MID144 PID84 FMI2")
  })

  it("has zero regression / exception wording or the old outcome", () => {
    for (const excludeApprovedExceptions of [true, false]) {
      const source = pdfSource(
        buildWorksTrackerPdf(
          buildWorksTrackerData(
            fourTruckInput(),
            { excludeApprovedExceptions },
            NOW
          )
        ).buffer
      )
      for (const banned of [
        "[NEW REGRESSION]",
        "Reg ",
        "approved exception",
        "[APPROVED EXCEPTION]",
        "In Workshop",
      ]) {
        expect(source.toLowerCase()).not.toContain(banned.toLowerCase())
      }
    }
  })

  it("prints the fleet rows in the selected order", () => {
    const rowOrder = (sortBy: "STATUS" | "FLEET_NO") => {
      const source = pdfSource(
        buildWorksTrackerPdf(
          buildWorksTrackerData(mixedInput(), { sortBy }, NOW)
        ).buffer
      )
      return [...source.matchAll(/\((MTL\d+)\) Tj/g)].map((match) => match[1])
    }
    expect(rowOrder("FLEET_NO")).toEqual([
      "MTL01",
      "MTL10",
      "MTL41",
      "MTL100",
      "MTL145",
    ])
    expect(rowOrder("STATUS")).toEqual([
      "MTL41",
      "MTL100",
      "MTL10",
      "MTL01",
      "MTL145",
    ])
    const source = pdfSource(
      buildWorksTrackerPdf(
        buildWorksTrackerData(mixedInput(), { sortBy: "FLEET_NO" }, NOW)
      ).buffer
    )
    expect(source).toContain("Order: Fleet No. \\(MTL01-MTL145\\)")
  })

  it("repeats the header across pages for a large fleet", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `MTL${i + 1}`)
    const big = buildWorksTrackerData(
      { sessions: [], ledger: [], exceptions: [], roster: roster(...ids) },
      undefined,
      NOW
    )
    const bigPdf = buildWorksTrackerPdf(big)
    expect(bigPdf.pageCount).toBeGreaterThan(1)
    expect(pdfSource(bigPdf.buffer)).toContain(
      "Fleet Diagnostic Works Tracker \\(continued\\)"
    )
  })

  it("splits a row taller than a page with (cont.)", () => {
    const keys = [
      "MID128|PID94|FMI5",
      "MID128|PID175|FMI5",
      "MID128|PID153|FMI5",
      "MID128|SID18|FMI5",
    ]
    const longDescription = "Long wrapped description of the failing circuit. ".repeat(8)
    const tall = mtl41Case()
    const taller = {
      ...tall,
      verificationScans: tall.verificationScans.map((scan) => ({
        ...scan,
        scanFaults: Array.from({ length: 70 }, (_, i) => ({
          ...scan.scanFaults[0],
          canonicalKey: `MID128|PID${300 + i}|FMI5`,
          dtcRaw: `PID ${300 + i} FMI 5`,
          description: `${longDescription} ${keys[i % keys.length]}`,
          reconciliationBucket: "PERSISTING_OPEN" as const,
          isApprovedException: false,
          pttStatus: "ACTIVE" as const,
          severity: "CRITICAL" as const,
          isBounceBack: false,
        })),
      })),
    }
    const result = buildWorksTrackerData(
      { sessions: [taller], ledger: [], exceptions: [], roster: [] },
      undefined,
      NOW
    )
    expect(rowOf(result.rows, "MTL41").residualFaultsCount).toBe(70)
    const tallPdf = buildWorksTrackerPdf(result)
    expect(tallPdf.pageCount).toBeGreaterThan(1)
    expect(pdfSource(tallPdf.buffer)).toContain("MTL41 \\(cont.\\)")
  })
})

describe("Works tracker Excel workbook", () => {
  const data = buildWorksTrackerData(fourTruckInput(), undefined, NOW)

  async function reload() {
    const file = await buildWorksTrackerWorkbookFile(data)
    const { default: ExcelJS } = await import("exceljs")
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(file.buffer)
    return { file, workbook }
  }

  it("is a valid .xlsx with exactly the two tabs", async () => {
    const { file, workbook } = await reload()
    expect(file.fileName).toBe("Miloto_PTT_Works_Tracker_2026-11-26.xlsx")
    expect(Buffer.from(file.buffer).subarray(0, 2).toString("latin1")).toBe("PK")
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Works Tracker",
      "Sweep Summary",
    ])
    expect([...WORKS_TRACKER_SHEET_NAMES]).toEqual([
      "Works Tracker",
      "Sweep Summary",
    ])
  })

  it("has the 12 headers, frozen row 1, filter and wrapped text on tab 1", async () => {
    const { workbook } = await reload()
    const sheet = workbook.getWorksheet("Works Tracker")
    if (!sheet) throw new Error("Missing Works Tracker sheet")
    const header = (sheet.getRow(1).values as unknown[]).slice(1).map(String)
    expect(header).toEqual([
      "Fleet No.",
      "Gen",
      "Tracker Status",
      "Closure Outcome",
      "Before Photo Date",
      "After Photo Date",
      "Turnaround / Open Days",
      "Before Faults",
      "Cleared Faults",
      "Residual Faults",
      "Cleared Fault Codes",
      "Residual Fault Codes",
    ])
    expect(header).toEqual([...WORKS_TRACKER_SHEET_HEADERS])
    expect(header).toHaveLength(12)
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 })
    // exceljs reads a stored filter back as an A1 range.
    expect(sheet.autoFilter).toBe("A1:L1")
    // Column letters: H/I/J = Before/Cleared/Residual, K/L = the fault codes.
    const letter = (column: string) => sheet.getCell(`${column}1`).value
    expect(letter("A")).toBe("Fleet No.")
    expect(letter("H")).toBe("Before Faults")
    expect(letter("I")).toBe("Cleared Faults")
    expect(letter("J")).toBe("Residual Faults")
    expect(letter("K")).toBe("Cleared Fault Codes")
    expect(letter("L")).toBe("Residual Fault Codes")
    expect(sheet.getColumn("K").width).toBeGreaterThanOrEqual(50)
    expect(sheet.getColumn("L").width).toBeGreaterThanOrEqual(50)
    expect(sheet.getRow(2).getCell(11).alignment?.wrapText).toBe(true)
    expect(sheet.getRow(2).getCell(12).alignment?.wrapText).toBe(true)
    // MTL41 (row 3) lists 5 residual lines: its row is tall.
    expect(sheet.getRow(3).height).toBeGreaterThan(60)
  })

  it("tab 1 carries the tracker numbers, statuses and fills", async () => {
    const { workbook } = await reload()
    const sheet = workbook.getWorksheet("Works Tracker")
    if (!sheet) throw new Error("Missing Works Tracker sheet")

    const rows = new Map<string, Record<string, unknown>>()
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const values = row.values as unknown[]
      rows.set(
        String(values[1]),
        Object.fromEntries(
          WORKS_TRACKER_SHEET_HEADERS.map((h, i) => [h, values[i + 1]])
        )
      )
    })
    expect([...rows.keys()]).toEqual(["MTL02", "MTL41", "MTL07", "MTL99"])

    const mtl41 = rows.get("MTL41")
    expect(mtl41).toMatchObject({
      "Tracker Status": "COMPLETE",
      "Closure Outcome": "Residual Faults",
      "Before Photo Date": "2026-11-20",
      "After Photo Date": "2026-11-24",
      "Turnaround / Open Days": 4,
      "Before Faults": rowOf(data.rows, "MTL41").openingFaultsCount,
      "Cleared Faults": 4,
      "Residual Faults": 5,
    })
    const text = (value: unknown) => String(value ?? "")
    const residualCodes = text(mtl41?.["Residual Fault Codes"])
    const clearedCodes = text(mtl41?.["Cleared Fault Codes"])
    expect(residualCodes).toContain("MID128 PID26 FMI3 - ")
    expect(residualCodes).not.toContain("[NEW REGRESSION]")
    expect(residualCodes.split("\n")).toHaveLength(5)
    expect(clearedCodes.split("\n")).toHaveLength(4)
    expect(clearedCodes.split("\n").every((line) => line.startsWith("MID128 "))).toBe(
      true
    )
    expect(rows.get("MTL02")?.["Residual Fault Codes"]).toBe(
      "None - All actionable faults cleared"
    )
    expect(text(rows.get("MTL07")?.["Cleared Fault Codes"])).toBe("")
    expect(rows.get("MTL07")).toMatchObject({
      "Tracker Status": "PARTIAL",
      "Closure Outcome": "Fault Clearance Pending",
      "Residual Fault Codes": "Awaiting final photo",
      "Turnaround / Open Days": 1,
    })
    expect(text(rows.get("MTL99")?.["Cleared Fault Codes"])).toBe("")
    expect(rows.get("MTL99")).toMatchObject({
      "Tracker Status": "PENDING",
      "Residual Fault Codes": "Pending baseline scan",
    })
    const argb = (rowNumber: number, column: number) =>
      (
        sheet.getRow(rowNumber).getCell(column).fill as
          | { fgColor?: { argb?: string } }
          | undefined
      )?.fgColor?.argb
    // Rows: 2 MTL02, 3 MTL41, 4 MTL07, 5 MTL99.
    expect(argb(3, 3)).toBe("FFD1FAE5") // COMPLETE green
    expect(argb(4, 3)).toBe("FFFDE68A") // PARTIAL amber
    expect(argb(5, 3)).toBe("FFF3F4F6") // PENDING soft grey
    expect(argb(3, 4)).toBe("FFFECACA") // Residual Faults soft red
    expect(argb(2, 4)).toBe("FFD1FAE5") // Clean Closure green
    expect(argb(4, 4)).toBe("FFFDE68A") // Fault Clearance Pending amber
    // No red fill is left on the count / fault code cells.
    for (const column of [8, 9, 10, 11, 12]) {
      expect(argb(3, column)).toBeUndefined()
    }
  })

  it("has zero regression / exception wording or the old outcome in any cell", async () => {
    for (const excludeApprovedExceptions of [true, false]) {
      const file = await buildWorksTrackerWorkbook(
        buildWorksTrackerData(fourTruckInput(), { excludeApprovedExceptions }, NOW)
      )
      const cells: string[] = []
      for (const sheet of file.worksheets) {
        sheet.eachRow((row) => {
          row.eachCell((cell) => {
            const value = cell.value
            cells.push(
              typeof value === "object" && value !== null
                ? JSON.stringify(value)
                : String(value)
            )
          })
        })
      }
      const text = cells.join("\n").toLowerCase()
      for (const banned of [
        "[new regression]",
        "reg ",
        "approved exception",
        "[approved exception]",
        "in workshop",
        "new regressions",
      ]) {
        expect(text).not.toContain(banned)
      }
    }
  })

  it("orders the Excel rows by Fleet No. when asked", async () => {
    const workbook = await buildWorksTrackerWorkbook(
      buildWorksTrackerData(mixedInput(), { sortBy: "FLEET_NO" }, NOW)
    )
    const sheet = workbook.getWorksheet("Works Tracker")
    if (!sheet) throw new Error("Missing Works Tracker sheet")
    const ids: string[] = []
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) ids.push(String(row.getCell(1).value))
    })
    expect(ids).toEqual(["MTL01", "MTL10", "MTL41", "MTL100", "MTL145"])
  })

  it("tab 2 uses live formulas over tab 1", async () => {
    const { workbook } = await reload()
    const sheet = workbook.getWorksheet("Sweep Summary")
    if (!sheet) throw new Error("Missing Sweep Summary sheet")

    type FormulaValue = { formula?: string; result?: unknown }
    const lookup = new Map<string, FormulaValue>()
    sheet.eachRow((row) => {
      const label = row.getCell(1).value
      const value = row.getCell(2).value
      if (typeof label === "string" && value !== null && typeof value === "object") {
        lookup.set(label, value as FormulaValue)
      }
    })

    const expectFormula = (label: string, pattern: RegExp, result: number) => {
      const entry = lookup.get(label)
      expect(entry?.formula, label).toMatch(pattern)
      expect(entry?.result, label).toBe(result)
    }
    expectFormula("Total Fleet", /^COUNTA\('Works Tracker'!\$A\$2:\$A\$5\)$/, 4)
    expectFormula("Complete", /^COUNTIF\('Works Tracker'!\$C\$2:\$C\$5,"COMPLETE"\)$/, 2)
    expectFormula("Partial", /^COUNTIF\(.*"PARTIAL"\)$/, 1)
    expectFormula("Pending", /^COUNTIF\(.*"PENDING"\)$/, 1)
    expectFormula("% Complete", /^IF\(B\d+=0,0,ROUND\(B\d+\/B\d+,3\)\)$/, 0.5)
    expectFormula("Clean Closures", /^COUNTIFS\(.*"COMPLETE".*\$J\$2:\$J\$5,0\)$/, 1)
    expectFormula(
      "Complete with Residual Faults",
      /^COUNTIFS\(.*"COMPLETE".*">0"\)$/,
      1
    )
    expectFormula("Total Cleared Faults", /^SUM\('Works Tracker'!\$I\$2:\$I\$5\)$/, 5)
    expectFormula(
      "Total Residual Faults",
      /^SUM\('Works Tracker'!\$J\$2:\$J\$5\)$/,
      5
    )
    expect(lookup.has("Total New Regressions")).toBe(false)

    // The "% Complete" cell references the Total / Complete cells above it.
    const total = lookup.get("Total Fleet")
    const complete = lookup.get("Complete")
    expect(total).toBeDefined()
    expect(complete).toBeDefined()
    const pctFormula = lookup.get("% Complete")?.formula ?? ""
    const refs = [...pctFormula.matchAll(/B(\d+)/g)].map((match) => Number(match[1]))
    const rowOfLabel = (label: string) => {
      let found = 0
      sheet.eachRow((row, rowNumber) => {
        if (row.getCell(1).value === label) found = rowNumber
      })
      return found
    }
    expect(refs[0]).toBe(rowOfLabel("Total Fleet"))
    expect(refs[1]).toBe(rowOfLabel("Complete"))

    // Breakdown by generation.
    const generations = new Map<string, unknown[]>()
    sheet.eachRow((row) => {
      const label = row.getCell(1).value
      if (label === "FH V3" || label === "FH V4" || label === "Unknown (not yet identified)") {
        generations.set(label, [2, 3, 4, 5, 6].map((c) => row.getCell(c).value))
      }
    })
    expect([...generations.keys()]).toEqual([
      "FH V3",
      "FH V4",
      "Unknown (not yet identified)",
    ])
    const v3 = generations.get("FH V3") as FormulaValue[]
    expect(v3[0].formula).toBe(`COUNTIF('Works Tracker'!$B$2:$B$5,"FH V3")`)
    expect(v3[1].formula).toBe(
      `COUNTIFS('Works Tracker'!$B$2:$B$5,"FH V3",'Works Tracker'!$C$2:$C$5,"COMPLETE")`
    )
    const results = (cells: FormulaValue[]) => cells.map((cell) => cell.result ?? 0)
    expect(results(v3)).toEqual([3, 2, 1, 0, 0.667])
    const v4 = generations.get("FH V4") as FormulaValue[]
    expect(results(v4)).toEqual([0, 0, 0, 0, 0])
    const unknown = generations.get("Unknown (not yet identified)") as FormulaValue[]
    expect(results(unknown)).toEqual([1, 0, 0, 1, 0])
  })

  it("still builds when no truck matches", async () => {
    const empty = buildWorksTrackerData(
      { sessions: [], ledger: [], exceptions: [], roster: [] },
      undefined,
      NOW
    )
    const workbook = await buildWorksTrackerWorkbook(empty)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      ...WORKS_TRACKER_SHEET_NAMES,
    ])
    expect(buildWorksTrackerPdf(empty).buffer.byteLength).toBeGreaterThan(1000)
  })
})

describe("Works tracker clean fault lines", () => {
  const KEY = "MID128|PID175|FMI5"
  const DESCRIPTION =
    "PID 175: Engine oil temperature, FMI 5: Current below normal or open circuit"

  const clearedCase = () => {
    const base = closedCase([KEY])
    const [verification] = base.verificationScans
    return {
      ...base,
      faults: [baselineFault(KEY, { componentDescription: DESCRIPTION })],
      verificationScans: [
        {
          ...verification,
          scanFaults: [
            scanFault(KEY, {
              description: DESCRIPTION,
              pttStatus: "INACTIVE",
              reconciliationBucket: "CLEARED",
            }),
          ],
        },
      ],
    }
  }

  it("strips a redundant leading code prefix from the description", () => {
    for (const [raw, clean] of [
      ["PID 175: Engine oil temperature", "Engine oil temperature"],
      ["PPID 3: Starter output", "Starter output"],
      ["PSID 214: Data link", "Data link"],
      ["SID 253: Calibration memory", "Calibration memory"],
      ["C103715: Chassis Lubrication Motor", "Chassis Lubrication Motor"],
      ["MID128 PID175 FMI5 - Engine oil", "Engine oil"],
      ["Engine oil temperature, FMI 5: Low", "Engine oil temperature, FMI 5: Low"],
    ]) {
      expect(stripLeadingCodePrefix(raw)).toBe(clean)
    }
    // A description that is only a code is never emptied.
    expect(stripLeadingCodePrefix("PID 175:")).toBe("PID 175:")
  })

  it("prints `MID128 PID175 FMI5 - Engine oil temperature, FMI 5: ...` with no PID 175 prefix", () => {
    const data = buildWorksTrackerData(
      { ...fourTruckInput(), sessions: [clearedCase()] },
      undefined,
      NOW
    )
    const row = rowOf(data.rows, "MTL02")
    expect(row.clearedFaultItems).toHaveLength(1)
    const [item] = row.clearedFaultItems
    expect(item.codeLabel).toBe("MID128 PID175 FMI5")
    expect(item.text).toBe(
      "MID128 PID175 FMI5 - Engine oil temperature, FMI 5: Current below normal or open circuit"
    )
    expect(item.text).not.toContain("PID 175:")
    expect(row.clearedFaultCodes).toBe(item.text)
  })

  it("never doubles the description (X - X) or prints an ECU CODE: Description string", () => {
    const base = closedCase([KEY])
    const [verification] = base.verificationScans
    const description = "Chassis Lubrication Motor, Circuit Short To Battery or Open"
    const unreadable = {
      ...base,
      faults: [],
      verificationScans: [
        {
          ...verification,
          scanFaults: [
            scanFault(KEY, {
              canonicalKey: "UNVERIFIED|MYSTERYBOX|C103715",
              ecuLabel: "Mystery Box",
              dtcRaw: `C103715: ${description}`,
              description: `C103715: ${description}`,
              pttStatus: "ACTIVE",
              reconciliationBucket: "PERSISTING_OPEN",
            }),
          ],
        },
      ],
    }
    const data = buildWorksTrackerData(
      { ...fourTruckInput(), sessions: [unreadable] },
      undefined,
      NOW
    )
    const items = [
      ...rowOf(data.rows, "MTL02").residualFaultItems,
      ...rowOf(data.rows, "MTL02").clearedFaultItems,
    ]
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(item.text).toBe(`Mystery Box C103715 - ${description}`)
      const [code, text] = item.text.split(" - ")
      expect(code).not.toBe(text)
      expect(item.text).not.toContain(":")
    }
  })
})
