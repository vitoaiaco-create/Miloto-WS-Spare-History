import { describe, expect, it } from "vitest"

import type { PttReportLedgerRow } from "./report-data"
import {
  FLEET_EXCEPTIONS,
  baselineOnlyCase,
  closedCase,
  mtl41Case,
} from "./report-fixtures"
import {
  WORKS_TRACKER_SHEET_HEADERS,
  WORKS_TRACKER_SHEET_NAMES,
  buildWorksTrackerWorkbook,
  buildWorksTrackerWorkbookFile,
} from "./works-tracker-excel"
import {
  buildWorksTrackerData,
  type PttWorksTrackerInput,
  type PttWorksTrackerRosterTruck,
  type WorksTrackerRow,
} from "./works-tracker-data"
import {
  PTT_WORKS_TRACKER_TITLE,
  WORKS_TRACKER_COLUMN_RATIOS,
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
      closingFaultCodes: "Pending baseline scan",
      beforePhotoDate: null,
      afterPhotoDate: null,
      turnaroundDays: null,
      openingFaultsCount: null,
      clearedFaultsCount: null,
      closingFaultsCount: null,
      newRegressionsCount: null,
      approvedExceptionsCount: 0,
      clearedFaultCodes: "",
      generation: "\u2014",
    })

    const partial = rowOf(data.rows, "MTL07")
    expect(partial).toMatchObject({
      trackerStatus: "PARTIAL",
      closureOutcome: "In Workshop",
      closingFaultCodes: "Awaiting final photo",
      beforePhotoDate: "2026-11-25",
      afterPhotoDate: null,
      turnaroundDays: 1,
      openingFaultsCount: 2,
      clearedFaultsCount: null,
      closingFaultsCount: null,
      newRegressionsCount: null,
      clearedFaultCodes: "",
      generation: "FH V3",
    })

    const mtl41 = rowOf(data.rows, "MTL41")
    expect(mtl41).toMatchObject({
      trackerStatus: "COMPLETE",
      closureOutcome: "Residual Faults",
      clearedFaultsCount: 4,
      closingFaultsCount: 5,
      newRegressionsCount: 1,
      approvedExceptionsCount: 9,
      beforePhotoDate: "2026-11-20",
      afterPhotoDate: "2026-11-24",
      turnaroundDays: 4,
    })
    const closing = mtl41.closingFaultCodes.split("\n")
    expect(closing).toHaveLength(5)
    expect(closing[0]).toMatch(/^\[NEW REGRESSION\] MID128 PID26 FMI3 \u2014 /)
    expect(mtl41.closingFaultCodes.startsWith("[NEW REGRESSION]")).toBe(true)
    // Repeat fault (ledger reopened once) is tagged; no exception is listed.
    expect(closing.some((line) => line.startsWith("[REPEAT x1] MID144 PID84 FMI2"))).toBe(
      true
    )
    expect(mtl41.closingFaultCodes).not.toContain("APPROVED EXCEPTION")
    expect(mtl41.approvedExceptionsNote).toBe("+9 approved exceptions excluded")
    expect(mtl41.clearedFaultCodes.split("\n")).toHaveLength(4)
    expect(mtl41.closingFaults[0]).toMatchObject({ isNewRegression: true })

    const clean = rowOf(data.rows, "MTL02")
    expect(clean).toMatchObject({
      trackerStatus: "COMPLETE",
      closureOutcome: "Clean Closure",
      closingFaultCodes: "None \u2014 All actionable faults cleared",
      closingFaultsCount: 0,
      newRegressionsCount: 0,
      clearedFaultsCount: 1,
      turnaroundDays: 4,
      approvedExceptionsNote: null,
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
      totalClosingActionableFaults: 5,
      totalNewRegressions: 1,
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
    expect(rowOf(all.rows, "MTL41").closingFaultsCount).toBe(5)
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

  it("lists approved exceptions when they are not excluded", () => {
    const included = buildWorksTrackerData(
      fourTruckInput(),
      { excludeApprovedExceptions: false },
      NOW
    )
    const mtl41 = rowOf(included.rows, "MTL41")
    expect(mtl41.closingFaultsCount).toBe(5)
    expect(mtl41.approvedExceptionsNote).toBeNull()
    expect(
      mtl41.closingFaultCodes
        .split("\n")
        .filter((line) => line.startsWith("[APPROVED EXCEPTION]"))
    ).toHaveLength(9)
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

  it("prints the 8 columns, KPI strip and the closing fault codes", () => {
    const source = pdfSource(pdf.buffer)
    for (const label of [
      "Tracker Status",
      "Before Photo",
      "After Photo",
      "Fault Tally",
      "Closure Outcome",
      "Closing Fault Codes",
      "Total Fleet",
      "Clean Closures",
      "Complete w/ Residual Faults",
      "PENDING",
      "PARTIAL",
      "COMPLETE",
      "Pending baseline scan",
      "Awaiting final photo",
      "[NEW REGRESSION] MID128 PID26 FMI3",
      "+9 approved exceptions excluded",
      "Clean Closure",
      "Residual Faults",
    ]) {
      expect(source).toContain(label)
    }
    expect(WORKS_TRACKER_COLUMN_RATIOS.reduce((a, b) => a + b, 0)).toBe(100)
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
    expect(rowOf(result.rows, "MTL41").closingFaultsCount).toBe(70)
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

  it("has the 14 headers, frozen row 1, filter and wrapped text on tab 1", async () => {
    const { workbook } = await reload()
    const sheet = workbook.getWorksheet("Works Tracker")
    if (!sheet) throw new Error("Missing Works Tracker sheet")
    const header = (sheet.getRow(1).values as unknown[]).slice(1).map(String)
    expect(header).toEqual([...WORKS_TRACKER_SHEET_HEADERS])
    expect(header).toHaveLength(14)
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 })
    // exceljs reads a stored filter back as an A1 range.
    expect(sheet.autoFilter).toBe("A1:N1")
    expect(sheet.getRow(2).getCell(13).alignment?.wrapText).toBe(true)
    expect(sheet.getRow(2).height).toBeGreaterThan(18)
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
      "Cleared Faults": 4,
      "Closing Faults": 5,
      "New Regressions": 1,
      "Approved Exceptions": 9,
    })
    expect(String(mtl41?.["Closing Fault Codes"])).toMatch(
      /^\[NEW REGRESSION\] MID128 PID26 FMI3 \u2014 /
    )
    expect(String(mtl41?.["Cleared Fault Codes"]).split("\n")).toHaveLength(4)
    expect(rows.get("MTL02")?.["Closing Fault Codes"]).toBe(
      "None \u2014 All actionable faults cleared"
    )
    expect(rows.get("MTL07")).toMatchObject({
      "Tracker Status": "PARTIAL",
      "Closure Outcome": "In Workshop",
      "Closing Fault Codes": "Awaiting final photo",
      "Turnaround / Open Days": 1,
    })
    expect(rows.get("MTL99")).toMatchObject({
      "Tracker Status": "PENDING",
      "Closing Fault Codes": "Pending baseline scan",
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
    expect(argb(3, 11)).toBe("FFDC2626") // regressions bold red
    expect(argb(2, 11)).toBeUndefined()
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
      "Total Closing Actionable Faults",
      /^SUM\('Works Tracker'!\$J\$2:\$J\$5\)$/,
      5
    )
    expectFormula("Total New Regressions", /^SUM\('Works Tracker'!\$K\$2:\$K\$5\)$/, 1)

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
