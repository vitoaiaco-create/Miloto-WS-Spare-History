import { describe, expect, it } from "vitest"

import { formatPttVerificationAuditForWhatsApp } from "./audit-format"
import {
  buildPttReportData,
  type PttReportCase,
  type PttReportLedgerRow,
} from "./report-data"
import { PTT_WORKBOOK_SHEET_NAMES, buildPttWorkbook } from "./report-excel"
import { buildExecutiveDirectivesPdf, buildFaultReportPdf } from "./report-pdf"
import {
  FLEET_EXCEPTIONS,
  baselineOnlyCase,
  closedCase,
  mtl41Case,
} from "./report-fixtures"
import { buildWorksTrackerWorkbook } from "./works-tracker-excel"
import {
  buildWorksTrackerData,
  type WorksTrackerRow,
} from "./works-tracker-data"
import { buildWorksTrackerPdf } from "./works-tracker-pdf"

const NOW = new Date(2026, 10, 26, 12, 0)
const NOTE = "Hydraulic pump sensor is unplugged on purpose"
const REASON = "Unused / disconnected sensor"

const ledger: PttReportLedgerRow[] = []

/** MTL41: the real blocked re-scan, released by a manager with its residuals. */
function acceptedMtl41(overrides: Partial<PttReportCase> = {}): PttReportCase {
  return mtl41Case({
    status: "VERIFIED_CLOSED",
    caseStatus: "CLOSED_ACCEPTED_RESIDUALS",
    closureReasonCategory: "UNUSED_DISCONNECTED_SENSOR",
    closureNote: NOTE,
    closedAt: new Date(2026, 10, 25, 10, 0),
    ...overrides,
  })
}

const sessions = (): PttReportCase[] => [
  acceptedMtl41(),
  baselineOnlyCase(["MID128|PID94|FMI5", "MID144|PPID3|FMI4"]),
  closedCase(["MID128|PID94|FMI5"]),
]

const pdfSource = (buffer: ArrayBuffer) => Buffer.from(buffer).toString("latin1")

function rowOf(rows: readonly WorksTrackerRow[], fleetId: string): WorksTrackerRow {
  const row = rows.find((candidate) => candidate.fleetId === fleetId)
  if (!row) throw new Error(`No tracker row for ${fleetId}`)
  return row
}

describe("report data: CLOSED (ACCEPTED RESIDUALS)", () => {
  const data = buildPttReportData(
    { sessions: sessions(), ledger, exceptions: FLEET_EXCEPTIONS },
    { scope: "LATEST_ALL" },
    NOW
  )
  const truck = data.trucks.find((candidate) => candidate.fleetId === "MTL41")

  it("labels the truck and carries the closure audit", () => {
    expect(truck).toMatchObject({
      caseStatus: "CLOSED_ACCEPTED_RESIDUALS",
      caseStatusLabel: "CLOSED (ACCEPTED RESIDUALS)",
      closureReasonLabel: REASON,
      closureNote: NOTE,
      closedDate: "2026-11-25",
    })
  })

  it("still lists the un-exempted residual faults and the exception note", () => {
    expect(truck?.outstandingCount).toBe(5)
    expect(truck?.approvedExceptionsCount).toBe(9)
  })

  it("drops off Open or Blocked Trucks without counting as a clean closure", () => {
    // Only the baseline-only MTL07 is still open.
    expect(data.kpis.openOrBlockedCount).toBe(1)
    // Only MTL02 was closed cleanly.
    expect(data.kpis.verifiedClosedCount).toBe(1)
  })
})

describe("report PDFs and Excel: closure visibility", () => {
  const data = buildPttReportData(
    { sessions: sessions(), ledger, exceptions: FLEET_EXCEPTIONS },
    { scope: "LATEST_ALL" },
    NOW
  )

  it("prints the closure callout, reason, note and the residuals in PDF 2", () => {
    const source = pdfSource(buildExecutiveDirectivesPdf(data).buffer)
    // jsPDF escapes parentheses and wraps long cells, so match fragments.
    expect(source).toContain("CLOSED \\(ACCEPTED RESIDUALS\\)")
    expect(source).toContain(`Reason: ${REASON}`)
    expect(source).toContain("Hydraulic pump sensor is unplugged on")
    expect(source).toContain("Closed: 2026-11-25")
    // Un-exempted residuals stay visible, with the excluded-exceptions note.
    expect(source).toContain("Outstanding Fault Codes")
    expect(source).toContain("+9 approved exceptions excluded")
  })

  it("keeps the fault report valid with a closed-with-residuals truck", () => {
    const source = pdfSource(buildFaultReportPdf(data).buffer)
    expect(source.startsWith("%PDF-")).toBe(true)
    expect(source).toContain("MTL41")
  })

  it("shows the closure audit in Excel tab 1", async () => {
    const workbook = await buildPttWorkbook(data)
    const sheet = workbook.getWorksheet(PTT_WORKBOOK_SHEET_NAMES[0])
    if (!sheet) throw new Error("Missing executive sheet")
    const cells: string[] = []
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "string") cells.push(cell.value)
      })
    })
    const text = cells.join("\n")
    expect(text).toContain("CLOSED (ACCEPTED RESIDUALS)")
    expect(text).toContain(REASON)
    expect(text).toContain(NOTE)
  })
})

describe("works tracker: Closed (Accepted Residuals)", () => {
  const input = {
    sessions: sessions(),
    ledger,
    exceptions: FLEET_EXCEPTIONS,
    roster: [
      { fleetId: "MTL41", generation: "FH_V3" as const },
      { fleetId: "MTL07", generation: "FH_V3" as const },
      { fleetId: "MTL02", generation: "FH_V3" as const },
    ],
  }
  const data = buildWorksTrackerData(input, undefined, NOW)

  it("stays COMPLETE with its own outcome and a closure note", () => {
    const row = rowOf(data.rows, "MTL41")
    expect(row).toMatchObject({
      trackerStatus: "COMPLETE",
      closureOutcome: "Closed (Accepted Residuals)",
    })
    expect(row.closureNote).toContain(REASON)
    expect(row.closureNote).toContain(NOTE)
    // The residuals the manager accepted are still listed.
    expect(row.closingFaultsCount).toBe(5)
    expect(row.closingFaultCodes).toContain("[NEW REGRESSION]")
  })

  it("splits Clean / Closed / Residual KPIs that add up to Complete", () => {
    expect(data.kpis).toMatchObject({
      completeCount: 2,
      cleanClosureCount: 1,
      closedAcceptedResidualsCount: 1,
      residualFaultsTrucksCount: 0,
    })
    expect(
      data.kpis.cleanClosureCount +
        data.kpis.closedAcceptedResidualsCount +
        data.kpis.residualFaultsTrucksCount
    ).toBe(data.kpis.completeCount)
  })

  it("prints the outcome in the tracker PDF", () => {
    const source = pdfSource(buildWorksTrackerPdf(data).buffer)
    expect(source).toContain("Closed \\(Accepted Residuals\\)")
    expect(source).toContain(`Closure: ${REASON}`)
    expect(source).toContain(NOTE)
  })

  it("reconciles Clean + Closed + Open-with-Residual = Complete in tab 2", async () => {
    const workbook = await buildWorksTrackerWorkbook(data)
    const sheet = workbook.getWorksheet("Sweep Summary")
    if (!sheet) throw new Error("Missing Sweep Summary sheet")

    // A formula that evaluates to 0 may omit its cached result.
    const results = new Map<string, number>()
    sheet.eachRow((row) => {
      const label = row.getCell(1).value
      const value = row.getCell(2).value
      if (
        typeof label === "string" &&
        value !== null &&
        typeof value === "object" &&
        "formula" in value
      ) {
        results.set(label, typeof value.result === "number" ? value.result : 0)
      }
    })

    const clean = results.get("Clean Closures")
    const closed = results.get("Closed (Accepted Residuals)")
    const residual = results.get("Complete with Residual Faults")
    expect(clean).toBe(1)
    expect(closed).toBe(1)
    expect(residual).toBe(0)
    expect((clean ?? 0) + (closed ?? 0) + (residual ?? 0)).toBe(
      results.get("Complete")
    )
  })
})

describe("WhatsApp audit: accepted residuals", () => {
  it("prints the closed status with reason and note", () => {
    const mtl41 = acceptedMtl41()
    const scan = mtl41.verificationScans[0]
    const message = formatPttVerificationAuditForWhatsApp({
      fleetId: "MTL41",
      caseStatus: "CLOSED_ACCEPTED_RESIDUALS",
      scannedAt: scan.scannedAt,
      summary: null,
      headerItemCount: null,
      extractedItemCount: null,
      gateOverrides: [],
      faults: [],
      verificationAudit: scan.verificationAudit,
      closure: { reasonLabel: REASON, note: NOTE },
    })
    expect(message).toContain("\u2705 CLOSED (Accepted Residuals)")
    expect(message).toContain(`*Closure reason:* ${REASON}`)
    expect(message).toContain(`*Closure note:* ${NOTE}`)
  })
})
