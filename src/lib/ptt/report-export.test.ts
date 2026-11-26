import { describe, expect, it } from "vitest"

import {
  buildPttReportData,
  type PttReportData,
  type PttReportInput,
  type PttReportLedgerRow,
} from "./report-data"
import {
  EXECUTIVE_SHEET_HEADERS,
  FAULT_REGISTER_HEADERS,
  LEDGER_SHEET_HEADERS,
  PTT_WORKBOOK_SHEET_NAMES,
  buildPttWorkbook,
  buildPttWorkbookFile,
} from "./report-excel"
import {
  EXECUTIVE_COLUMN_RATIOS,
  PTT_EXECUTIVE_REPORT_TITLE,
  PTT_FAULT_REPORT_TITLE,
  buildExecutiveDirectivesPdf,
  buildFaultReportPdf,
} from "./report-pdf"
import {
  FLEET_EXCEPTIONS,
  DIRECTIVE,
  baselineOnlyCase,
  closedCase,
  mtl41Case,
} from "./report-fixtures"

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
  {
    fleetId: "MTL02",
    canonicalKey: "MID128|PID94|FMI5",
    ecuLabel: "MID 128",
    description: "Fuel Delivery Pressure",
    latestSeverity: "CRITICAL",
    ledgerStatus: "CLEARED",
    firstSeenAt: new Date(2026, 10, 10),
    lastSeenAt: new Date(2026, 10, 18),
    clearedAt: new Date(2026, 10, 22),
    reopenCount: 0,
    lastReopenedAt: null,
  },
]

function reportData(overrides: Partial<PttReportInput> = {}): PttReportData {
  const input: PttReportInput = {
    sessions: [
      mtl41Case(),
      baselineOnlyCase(["MID128|PID94|FMI5", "MID144|PPID3|FMI4"]),
      closedCase(["MID128|PID94|FMI5"]),
    ],
    ledger,
    exceptions: FLEET_EXCEPTIONS,
    ...overrides,
  }
  return buildPttReportData(input, { scope: "LATEST_ALL" }, NOW)
}

// jsPDF writes uncompressed content streams, so printed text is searchable.
const pdfSource = (buffer: ArrayBuffer) => Buffer.from(buffer).toString("latin1")

describe("PDF builders", () => {
  const data = reportData()
  const faultPdf = buildFaultReportPdf(data)
  const executivePdf = buildExecutiveDirectivesPdf(data)

  it("return valid, non-empty PDF files", () => {
    for (const pdf of [faultPdf, executivePdf]) {
      expect(pdf.buffer.byteLength).toBeGreaterThan(1500)
      expect(pdfSource(pdf.buffer).startsWith("%PDF-")).toBe(true)
      expect(pdfSource(pdf.buffer).trimEnd().endsWith("%%EOF")).toBe(true)
      expect(pdf.pageCount).toBeGreaterThanOrEqual(1)
    }
  })

  it("are two standalone reports with distinct titles and file names", () => {
    expect(faultPdf.title).toBe(PTT_FAULT_REPORT_TITLE)
    expect(executivePdf.title).toBe(PTT_EXECUTIVE_REPORT_TITLE)
    expect(faultPdf.title).not.toBe(executivePdf.title)
    expect(faultPdf.fileName).toBe("Miloto_PTT_Fault_Report_Latest_All_2026-11-26.pdf")
    expect(executivePdf.fileName).toBe(
      "Miloto_PTT_Executive_Directives_Latest_All_2026-11-26.pdf"
    )
  })

  it("keeps the executive summary out of the fault report", () => {
    const fault = pdfSource(faultPdf.buffer)
    expect(fault).toContain("Fault Code / ECU")
    expect(fault).toContain("Reconciliation")
    expect(fault).not.toContain("Executive Truck Directives Summary")
    expect(fault).not.toContain("PARTS-WARNING-TEXT")
    expect(fault).not.toContain("Outstanding Fault Codes")
  })

  it("prints the 6-column executive table with its KPI strip", () => {
    const executive = pdfSource(executivePdf.buffer)
    for (const label of [
      "Executive Truck Directives Summary",
      "Truck & Status",
      "Cleared Fault Codes",
      "Outstanding Fault Codes",
      "Diagnosis & Parts Warning",
      "Physical Checks",
      "PTT Paths & Verification",
      "Outstanding Actionable",
      "First-Time Fix Rate %",
      "COLLATERAL DAMAGE",
      "PARTS WARNING",
      "NEXT FLOOR ACTIONS",
      "+9 approved exceptions excluded",
    ]) {
      expect(executive).toContain(label)
    }
    expect(executive).not.toContain("Fault Code / ECU")
  })

  it("uses exact column ratios that fill the printable width", () => {
    expect(EXECUTIVE_COLUMN_RATIOS).toEqual([11, 16, 19, 21, 16, 17])
    expect(EXECUTIVE_COLUMN_RATIOS.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it("splits a row taller than a page instead of looping or clipping", () => {
    const long = "Long wrapped sentence about the engine harness. ".repeat(60)
    const tall = baselineOnlyCase(["MID128|PID94|FMI5"], {
      aiDirective: {
        ...DIRECTIVE,
        true_diagnosis: long,
        parts_cannon_warning: long,
        physical_inspections: Array.from({ length: 30 }, (_, i) => `${long.slice(0, 160)} ${i}`),
      },
    })
    const pdf = buildExecutiveDirectivesPdf(
      buildPttReportData(
        { sessions: [tall], ledger: [], exceptions: FLEET_EXCEPTIONS },
        undefined,
        NOW
      )
    )
    expect(pdf.pageCount).toBeGreaterThan(1)
    // Parentheses are escaped inside PDF string literals.
    expect(pdfSource(pdf.buffer)).toContain("MTL07 \\(cont.\\)")
  })

  it("still renders when no truck matches", () => {
    const empty = buildPttReportData(
      { sessions: [], ledger: [], exceptions: [] },
      undefined,
      NOW
    )
    expect(buildFaultReportPdf(empty).buffer.byteLength).toBeGreaterThan(1000)
    expect(buildExecutiveDirectivesPdf(empty).buffer.byteLength).toBeGreaterThan(1000)
  })
})

describe("Excel workbook", () => {
  const data = reportData()

  async function sheetRows(name: string) {
    const workbook = await buildPttWorkbook(data)
    const sheet = workbook.getWorksheet(name)
    if (!sheet) throw new Error(`Missing sheet ${name}`)
    const header = (sheet.getRow(1).values as unknown[]).slice(1).map(String)
    const rows: Record<string, unknown>[] = []
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const values = row.values as unknown[]
      rows.push(Object.fromEntries(header.map((h, i) => [h, values[i + 1]])))
    })
    return { sheet, header, rows }
  }

  it("is a valid .xlsx with the three tabs, executive-first", async () => {
    const file = await buildPttWorkbookFile(data)
    expect(file.fileName).toBe("Miloto_PTT_Diagnostics_Latest_All_2026-11-26.xlsx")
    const bytes = Buffer.from(file.buffer)
    // .xlsx is a zip archive.
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK")

    const { default: ExcelJS } = await import("exceljs")
    const reloaded = new ExcelJS.Workbook()
    await reloaded.xlsx.load(file.buffer)
    expect(reloaded.worksheets.map((sheet) => sheet.name)).toEqual([
      "Executive Truck Directives",
      "Fault Register",
      "Truck Fault Ledger",
    ])
    expect([...PTT_WORKBOOK_SHEET_NAMES]).toEqual(
      reloaded.worksheets.map((sheet) => sheet.name)
    )
  })

  it("has the exact column headers on every tab", async () => {
    expect((await sheetRows("Executive Truck Directives")).header).toEqual([
      ...EXECUTIVE_SHEET_HEADERS,
    ])
    expect((await sheetRows("Fault Register")).header).toEqual([
      ...FAULT_REGISTER_HEADERS,
    ])
    expect((await sheetRows("Truck Fault Ledger")).header).toEqual([
      ...LEDGER_SHEET_HEADERS,
    ])
    expect(EXECUTIVE_SHEET_HEADERS).toHaveLength(18)
    expect(FAULT_REGISTER_HEADERS).toHaveLength(14)
    expect(LEDGER_SHEET_HEADERS).toHaveLength(13)
  })

  it("freezes row 1, filters all columns and wraps text on every tab", async () => {
    for (const name of PTT_WORKBOOK_SHEET_NAMES) {
      const { sheet, header } = await sheetRows(name)
      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 })
      expect(sheet.autoFilter).toMatchObject({
        from: { row: 1, column: 1 },
        to: { row: 1, column: header.length },
      })
      expect(sheet.getRow(2).getCell(1).alignment?.wrapText).toBe(true)
    }
  })

  it("Tab 1 matches the PDF numbers, lists and statuses", async () => {
    const { rows } = await sheetRows("Executive Truck Directives")
    expect(rows).toHaveLength(data.trucks.length)

    const mtl41 = rows.find((row) => row["Fleet No."] === "MTL41")
    expect(mtl41).toBeDefined()
    expect(mtl41?.["Case Status"]).toBe("PARTIAL / BLOCKED")
    expect(mtl41?.["Cleared Count"]).toBe(4)
    expect(mtl41?.["Outstanding Count"]).toBe(5)
    expect(mtl41?.["New Regressions Count"]).toBe(1)
    expect(mtl41?.["Approved Exceptions Count"]).toBe(9)
    expect(String(mtl41?.["Cleared Fault Codes"]).split("\n")).toHaveLength(4)
    const outstanding = String(mtl41?.["Outstanding Fault Codes"]).split("\n")
    expect(outstanding[0]).toMatch(/^\[NEW REGRESSION\] MID128 PID26 FMI3 \u2014 /)
    expect(outstanding.at(-1)).toBe("+9 approved exceptions excluded")
    expect(String(mtl41?.["Forensic Verification Audit"])).toContain(
      "COLLATERAL-TEXT"
    )

    const baseline = rows.find((row) => row["Fleet No."] === "MTL07")
    expect(baseline?.["Cleared Fault Codes"]).toBe("Awaiting verification scan")
    expect(baseline?.["Last Verified Date"]).toBe("")
    expect(baseline?.["Forensic Verification Audit"]).toBe("")
    expect(baseline?.["Case Status"]).toBe("OPEN")

    const closed = rows.find((row) => row["Fleet No."] === "MTL02")
    expect(closed?.["Case Status"]).toBe("VERIFIED CLOSED")
    expect(closed?.["Outstanding Fault Codes"]).toBe(
      "None \u2014 All actionable faults cleared"
    )
  })

  it("highlights case status and regressions", async () => {
    const { sheet, header, rows } = await sheetRows("Executive Truck Directives")
    const statusCol = header.indexOf("Case Status") + 1
    const regCol = header.indexOf("New Regressions Count") + 1
    const argb = (row: number, col: number) =>
      (
        sheet.getRow(row).getCell(col).fill as
          | { fgColor?: { argb?: string } }
          | undefined
      )?.fgColor?.argb
    const rowOf = (fleet: string) =>
      rows.findIndex((row) => row["Fleet No."] === fleet) + 2

    expect(argb(rowOf("MTL02"), statusCol)).toBe("FFD1FAE5") // green
    expect(argb(rowOf("MTL41"), statusCol)).toBe("FFFECACA") // soft red
    expect(argb(rowOf("MTL07"), statusCol)).toBe("FFFDE68A") // soft amber
    expect(argb(rowOf("MTL41"), regCol)).toBe("FFDC2626") // bold red
    expect(argb(rowOf("MTL07"), regCol)).toBeUndefined()
  })

  it("Tab 2 carries per-fault interventions, never the truck directive", async () => {
    const { rows } = await sheetRows("Fault Register")
    expect(rows).toHaveLength(data.faultRows.length)

    const directiveText = [
      DIRECTIVE.parts_cannon_warning,
      DIRECTIVE.true_diagnosis,
      "COLLATERAL-TEXT",
    ]
    for (const row of rows) {
      const intervention = String(row["Per-Fault Intervention"])
      expect(intervention.length).toBeGreaterThan(0)
      for (const text of directiveText) expect(intervention).not.toContain(text)
      expect(["Cleared", "Still Open", "New Regression", "Inactive"]).toContain(
        row["Reconciliation Status"]
      )
      expect(typeof row["Repeat / Reopen Count"]).toBe("number")
      expect(String(row["Canonical Key"])).toMatch(/^MID\d+\|/)
    }
    // Approved exceptions are excluded by default.
    expect(
      rows.some((row) => row["Reconciliation Status"] === "Approved Exception")
    ).toBe(false)

    const regression = rows.find(
      (row) => row["Reconciliation Status"] === "New Regression"
    )
    expect(regression?.["Canonical Key"]).toBe("MID128|PID26|FMI3")
    const repeat = rows.find(
      (row) =>
        row["Fleet No."] === "MTL41" &&
        row["Canonical Key"] === "MID144|PID84|FMI2"
    )
    expect(repeat?.["Repeat / Reopen Count"]).toBe(1)
  })

  it("Tab 2 includes approved exceptions when exclusion is off", async () => {
    const included = buildPttReportData(
      {
        sessions: [mtl41Case()],
        ledger: [],
        exceptions: FLEET_EXCEPTIONS,
      },
      { excludeApprovedExceptions: false },
      NOW
    )
    const workbook = await buildPttWorkbook(included)
    const sheet = workbook.getWorksheet("Fault Register")
    const statusCol = FAULT_REGISTER_HEADERS.indexOf("Reconciliation Status") + 1
    let exceptions = 0
    sheet?.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && row.getCell(statusCol).value === "Approved Exception") {
        exceptions += 1
      }
    })
    expect(exceptions).toBe(9)
  })

  it("Tab 3 is the living ledger with numeric Days Open", async () => {
    const { rows } = await sheetRows("Truck Fault Ledger")
    expect(rows.map((row) => `${row["Fleet No."]}:${row["Ledger Status"]}`)).toEqual([
      "MTL02:CLEARED",
      "MTL41:REOPENED",
    ])
    expect(rows[0]["Days Open"]).toBe(12)
    expect(rows[0]["Cleared Date"]).toBe("2026-11-22")
    expect(rows[1]["Days Open"]).toBe(25)
    expect(rows[1]["Reopen Count"]).toBe(1)
    expect(rows[1]["Cleared Date"]).toBe("")
    expect(rows[1]["Last Reopened Date"]).toBe("2026-11-24")
  })
})
