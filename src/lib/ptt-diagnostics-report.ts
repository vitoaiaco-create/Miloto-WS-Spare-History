import { format } from "date-fns"
import { saveAs } from "file-saver"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

import {
  PTT_FAULT_SEVERITIES,
  PTT_SEVERITY_RANK,
  compareFleetIds,
  latestSessionByFleet,
  normalizeFleetId,
  summarizePttFaults,
  type PttDirective,
  type PttFaultSeverity,
  type PttOverallSeverity,
} from "@/lib/ptt-diagnostics"

// Shared filter, row flattening and Excel / PDF generators for the Fleet
// Diagnostics (PTT Intel) module. One pure, client-safe module (no
// `@/db/schema` import, no `server-only`) so the dialog's live counter, the
// Fleet Fault Intelligence register, the Excel workbook and the PDF all run
// the exact same `buildPttFaultReportRows` and therefore always agree.

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

export const PTT_REPORT_SCOPES = [
  "LATEST_OPEN",
  "LATEST_ALL",
  "ALL_SCANS",
] as const
export type PttReportScope = (typeof PTT_REPORT_SCOPES)[number]

export const PTT_REPORT_SCOPE_LABELS: Record<PttReportScope, string> = {
  LATEST_OPEN: "Latest Open Scan per Truck",
  LATEST_ALL: "Latest Scan per Truck (Incl. Closed)",
  ALL_SCANS: "All Historical Scans",
}

const PTT_REPORT_SCOPE_FILE_PARTS: Record<PttReportScope, string> = {
  LATEST_OPEN: "Latest_Open",
  LATEST_ALL: "Latest_All",
  ALL_SCANS: "All_Scans",
}

export type PttReportFilterOptions = {
  /**
   * `LATEST_OPEN` (default): each truck's latest scan, unless it is already
   * `VERIFIED_CLOSED`, ignoring faults resolved on re-scan - the same set the
   * Fleet Fault Intelligence recurring groups are built from.
   * `LATEST_ALL`: each truck's latest scan, closed or not.
   * `ALL_SCANS`: every scan ever logged.
   */
  scope: PttReportScope
  /** Faults of these severities are kept (default: all four). */
  severities: PttFaultSeverity[]
  /** A specific normalized fleet number, or `'ALL'`. */
  fleetId: string | "ALL"
  /** `YYYY-MM-DD` (from <input type="date">), filtering on the scan date. */
  fromDate?: string
  toDate?: string
}

export const DEFAULT_PTT_REPORT_OPTIONS: PttReportFilterOptions = {
  scope: "LATEST_OPEN",
  severities: [...PTT_FAULT_SEVERITIES],
  fleetId: "ALL",
}

export const PTT_SEVERITY_FILTER_LABELS: Record<PttFaultSeverity, string> = {
  CRITICAL: "Critical",
  CALIBRATION_ONLY: "Calibration Only",
  MONITOR: "Monitor",
  NEGLIGIBLE: "Negligible",
}

// ---------------------------------------------------------------------------
// Input shape (structural, so a Drizzle row with `faults` fits as-is)
// ---------------------------------------------------------------------------

export type PttReportFault = {
  faultCode: string
  controlUnit: string
  componentDescription: string
  faultState: string
  occurrenceCount: number | null
  severity: PttFaultSeverity
  calibrationRequired: boolean
  rootCauseSummary: string
  resolvedOnRescan: boolean
}

export type PttReportSession = {
  id: number
  fleetId: string
  truckGeneration: string
  status: string
  scannedAt: Date
  aiDirective: PttDirective | null
  faults: readonly PttReportFault[]
}

// ---------------------------------------------------------------------------
// Output rows
// ---------------------------------------------------------------------------

export type PttFaultReportRow = {
  /** `YYYY-MM-DD`. */
  scanDate: string
  fleetId: string
  /** `FH V3` / `FH V4` / `Unknown`. */
  truckGeneration: string
  sessionStatus: string
  faultCode: string
  controlUnit: string
  faultState: "ACTIVE" | "INACTIVE" | "UNKNOWN"
  occurrenceCount: number | null
  pttDescription: string
  aiSeverity: PttFaultSeverity
  calibrationRequired: boolean
  /** The fault's `rootCauseSummary`. */
  faultIntervention: string
  /** Plain-text digest of the truck's directive (warning, checks, paths, criteria). */
  workshopDirectiveSummary: string
  sessionId: number
}

export type PttTruckSummaryRow = {
  scanDate: string
  fleetId: string
  truckGeneration: string
  sessionStatus: string
  /** Worst severity among the faults kept by the filter. */
  overallSeverity: PttOverallSeverity
  totalFaults: number
  criticalFaults: number
  calibrationFaults: number
  monitorFaults: number
  negligibleFaults: number
  trueDiagnosis: string
  partsCannonWarning: string
  /** Numbered, one check per line. */
  physicalInspections: string
  /** Bulleted, one path per line. */
  pttPaths: string
  /** Bulleted, one criterion per line. */
  verificationCriteria: string
  sessionId: number
}

export type PttReportRows = {
  faultRows: PttFaultReportRow[]
  /** One row per matching session (a session with at least one fault row). */
  truckSummaryRows: PttTruckSummaryRow[]
  /** Distinct trucks among `faultRows`. */
  truckCount: number
}

const SESSION_STATUS_LABELS: Record<string, string> = {
  SCANNED: "Scanned",
  DIRECTIVE_ISSUED: "Directive Issued",
  IN_PROGRESS: "In Progress",
  VERIFIED_CLOSED: "Verified Closed",
}

const GENERATION_REPORT_LABELS: Record<string, string> = {
  FH_V3: "FH V3",
  FH_V4: "FH V4",
}

const SEVERITY_DISPLAY: Record<PttOverallSeverity, string> = {
  ...PTT_SEVERITY_FILTER_LABELS,
  CLEAR: "Clear",
}

function formatScanDate(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

// `YYYY-MM-DD` -> local-time day boundaries (same as the HR report).
function startOfDay(value?: string): number | null {
  return value ? new Date(`${value}T00:00:00`).getTime() : null
}

function endOfDay(value?: string): number | null {
  return value ? new Date(`${value}T23:59:59.999`).getTime() : null
}

function normalizeFaultState(state: string): "ACTIVE" | "INACTIVE" | "UNKNOWN" {
  return state === "ACTIVE" || state === "INACTIVE" ? state : "UNKNOWN"
}

function numbered(items: readonly string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, i) => `${i + 1}. ${item}`)
    .join("\n")
}

function bulleted(items: readonly string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `\u2022 ${item}`)
    .join("\n")
}

function inline(items: readonly string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .join("; ")
}

// "Parts Warning: ...\nPhysical Inspections: a; b\nPTT Paths: ...".
function buildDirectiveSummary(directive: PttDirective | null): string {
  if (!directive) return ""
  const sections: [string, string][] = [
    ["Parts Warning", directive.parts_cannon_warning.trim()],
    ["Physical Inspections", inline(directive.physical_inspections)],
    ["PTT Paths", inline(directive.ptt_navigation_paths)],
    ["Verification Criteria", inline(directive.verification_criteria)],
  ]
  return sections
    .filter(([, text]) => text)
    .map(([label, text]) => `${label}: ${text}`)
    .join("\n")
}

function resolveOptions(
  options: Partial<PttReportFilterOptions> | undefined
): PttReportFilterOptions {
  const fleetId = options?.fleetId?.trim()
  return {
    scope: options?.scope ?? DEFAULT_PTT_REPORT_OPTIONS.scope,
    severities: options?.severities ?? [...PTT_FAULT_SEVERITIES],
    fleetId: !fleetId || fleetId === "ALL" ? "ALL" : normalizeFleetId(fleetId),
    fromDate: options?.fromDate || undefined,
    toDate: options?.toDate || undefined,
  }
}

// ---------------------------------------------------------------------------
// Shared filter + row builder
// ---------------------------------------------------------------------------

/**
 * Single source of truth for which faults a scope / severity / truck / date
 * selection yields. The scope picks the scans first (latest per truck, or all);
 * the truck, date range and severity filters then narrow them, so "latest"
 * always means the truck's genuine latest scan.
 *
 * `faultRows` are sorted by scan time (newest first), natural fleet number,
 * then worst severity first.
 */
export function buildPttFaultReportRows(
  sessions: readonly PttReportSession[],
  options?: Partial<PttReportFilterOptions>
): PttReportRows {
  const { scope, severities, fleetId, fromDate, toDate } =
    resolveOptions(options)
  const severitySet = new Set<PttFaultSeverity>(severities)
  const fromMs = startOfDay(fromDate)
  const toMs = endOfDay(toDate)

  let scoped: PttReportSession[]
  if (scope === "ALL_SCANS") {
    scoped = [...sessions]
  } else {
    scoped = [...latestSessionByFleet(sessions).values()]
    if (scope === "LATEST_OPEN") {
      scoped = scoped.filter((session) => session.status !== "VERIFIED_CLOSED")
    }
  }

  const matched = scoped.filter((session) => {
    if (fleetId !== "ALL" && normalizeFleetId(session.fleetId) !== fleetId) {
      return false
    }
    const scannedMs = session.scannedAt.getTime()
    if (fromMs !== null && scannedMs < fromMs) return false
    if (toMs !== null && scannedMs > toMs) return false
    return true
  })

  type Entry = { session: PttReportSession; fault: PttReportFault }
  const entries: Entry[] = []
  for (const session of matched) {
    for (const fault of session.faults) {
      if (!severitySet.has(fault.severity)) continue
      // Outstanding-only: faults already cleared by a re-scan are not open work.
      if (scope === "LATEST_OPEN" && fault.resolvedOnRescan) continue
      entries.push({ session, fault })
    }
  }

  entries.sort(
    (a, b) =>
      b.session.scannedAt.getTime() - a.session.scannedAt.getTime() ||
      compareFleetIds(a.session.fleetId, b.session.fleetId) ||
      b.session.id - a.session.id ||
      PTT_SEVERITY_RANK[b.fault.severity] - PTT_SEVERITY_RANK[a.fault.severity]
  )

  const faultRows: PttFaultReportRow[] = []
  const truckSummaryRows: PttTruckSummaryRow[] = []
  const directiveSummaries = new Map<number, string>()
  const faultsBySession = new Map<number, PttReportFault[]>()

  for (const { session, fault } of entries) {
    let directiveSummary = directiveSummaries.get(session.id)
    if (directiveSummary === undefined) {
      directiveSummary = buildDirectiveSummary(session.aiDirective)
      directiveSummaries.set(session.id, directiveSummary)
    }

    const sessionFaults = faultsBySession.get(session.id)
    if (sessionFaults) {
      sessionFaults.push(fault)
    } else {
      faultsBySession.set(session.id, [fault])
    }

    faultRows.push({
      scanDate: formatScanDate(session.scannedAt),
      fleetId: normalizeFleetId(session.fleetId),
      truckGeneration:
        GENERATION_REPORT_LABELS[session.truckGeneration] ?? "Unknown",
      sessionStatus: SESSION_STATUS_LABELS[session.status] ?? session.status,
      faultCode: fault.faultCode,
      controlUnit: fault.controlUnit,
      faultState: normalizeFaultState(fault.faultState),
      occurrenceCount: fault.occurrenceCount,
      pttDescription: fault.componentDescription,
      aiSeverity: fault.severity,
      calibrationRequired: fault.calibrationRequired,
      faultIntervention: fault.rootCauseSummary,
      workshopDirectiveSummary: directiveSummary,
      sessionId: session.id,
    })
  }

  // Sessions in order of first appearance (= the same sort as the faults).
  const seenSessions = new Set<number>()
  for (const { session } of entries) {
    if (seenSessions.has(session.id)) continue
    seenSessions.add(session.id)

    const summary = summarizePttFaults(faultsBySession.get(session.id) ?? [])
    const directive = session.aiDirective
    truckSummaryRows.push({
      scanDate: formatScanDate(session.scannedAt),
      fleetId: normalizeFleetId(session.fleetId),
      truckGeneration:
        GENERATION_REPORT_LABELS[session.truckGeneration] ?? "Unknown",
      sessionStatus: SESSION_STATUS_LABELS[session.status] ?? session.status,
      overallSeverity: summary.overallSeverity,
      totalFaults: faultsBySession.get(session.id)?.length ?? 0,
      criticalFaults: summary.criticalCount,
      calibrationFaults: summary.calibrationCount,
      monitorFaults: summary.monitorCount,
      negligibleFaults: summary.negligibleCount,
      trueDiagnosis: directive?.true_diagnosis.trim() ?? "",
      partsCannonWarning: directive?.parts_cannon_warning.trim() ?? "",
      physicalInspections: numbered(directive?.physical_inspections ?? []),
      pttPaths: bulleted(directive?.ptt_navigation_paths ?? []),
      verificationCriteria: bulleted(directive?.verification_criteria ?? []),
      sessionId: session.id,
    })
  }

  return {
    faultRows,
    truckSummaryRows,
    truckCount: new Set(faultRows.map((row) => row.fleetId)).size,
  }
}

// ---------------------------------------------------------------------------
// Shared helpers for the generators
// ---------------------------------------------------------------------------

function fileName(
  options: PttReportFilterOptions,
  extension: "xlsx" | "pdf",
  generatedAt: Date
): string {
  return `Miloto_PTT_Diagnostics_${PTT_REPORT_SCOPE_FILE_PARTS[options.scope]}_${format(generatedAt, "yyyy-MM-dd")}.${extension}`
}

function formatRange(fromDate?: string, toDate?: string): string | null {
  const fmt = (value: string) =>
    format(new Date(`${value}T00:00:00`), "dd MMM yyyy")
  if (fromDate && toDate) return `${fmt(fromDate)} to ${fmt(toDate)}`
  if (fromDate) return `From ${fmt(fromDate)}`
  if (toDate) return `Up to ${fmt(toDate)}`
  return null
}

// Human-readable filter summary lines for the PDF subtitle.
function describeFilters(options: PttReportFilterOptions): string[] {
  const lines = [`Scope: ${PTT_REPORT_SCOPE_LABELS[options.scope]}`]

  const allSeverities = PTT_FAULT_SEVERITIES.every((s) =>
    options.severities.includes(s)
  )
  const filters: string[] = []
  filters.push(
    `Severity: ${
      allSeverities
        ? "All"
        : PTT_FAULT_SEVERITIES.filter((s) => options.severities.includes(s))
            .map((s) => PTT_SEVERITY_FILTER_LABELS[s])
            .join(", ") || "None"
    }`
  )
  filters.push(
    `Truck: ${options.fleetId === "ALL" ? "All trucks" : options.fleetId}`
  )
  const range = formatRange(options.fromDate, options.toDate)
  if (range) filters.push(`Scan date: ${range}`)
  lines.push(filters.join("  |  "))
  return lines
}

// ---------------------------------------------------------------------------
// Excel (.xlsx)
// ---------------------------------------------------------------------------

// ARGB fills (soft tints) per AI severity.
const SEVERITY_FILL_ARGB: Record<PttOverallSeverity, string> = {
  CRITICAL: "FFFECACA",
  CALIBRATION_ONLY: "FFE9D5FF",
  MONITOR: "FFFDE68A",
  NEGLIGIBLE: "FFE5E7EB",
  CLEAR: "FFD1FAE5",
}

const SEVERITY_FONT_ARGB: Record<PttOverallSeverity, string> = {
  CRITICAL: "FF991B1B",
  CALIBRATION_ONLY: "FF6B21A8",
  MONITOR: "FF92400E",
  NEGLIGIBLE: "FF374151",
  CLEAR: "FF065F46",
}

const EXCEL_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/**
 * Builds the two-sheet workbook (`Fault Register`, `Truck Directives`) with
 * `exceljs` in the browser and downloads it as
 * `Miloto_PTT_Diagnostics_<Scope>_<YYYY-MM-DD>.xlsx`.
 */
export async function generatePttDiagnosticsExcel(
  sessions: readonly PttReportSession[],
  options?: Partial<PttReportFilterOptions>
): Promise<void> {
  const resolved = resolveOptions(options)
  const { faultRows, truckSummaryRows } = buildPttFaultReportRows(
    sessions,
    resolved
  )
  const generatedAt = new Date()

  // Loaded on demand so the (large) library stays out of the initial bundle.
  const { default: ExcelJS } = await import("exceljs")
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Miloto Transport Limited"
  workbook.created = generatedAt

  type Column = { header: string; key: string; width: number }

  function addSheet<Row extends object>(
    name: string,
    columns: Column[],
    rows: Row[],
    wrapKeys: string[],
    centerKeys: string[],
    severityKeys: { key: string; severityOf: (row: Row) => PttOverallSeverity }[]
  ) {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    })
    sheet.columns = columns
    sheet.addRows(rows)

    const headerRow = sheet.getRow(1)
    headerRow.height = 24
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1E293B" },
      }
      cell.alignment = {
        vertical: "middle",
        horizontal: "left",
        wrapText: true,
      }
    })

    const thin = { style: "thin" as const, color: { argb: "FFD1D5DB" } }
    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = { top: thin, left: thin, bottom: thin, right: thin }
      })
      if (rowNumber === 1) return
      row.alignment = { vertical: "top" }
      row.eachCell((cell, colNumber) => {
        const key = columns[colNumber - 1]?.key
        if (!key) return
        cell.alignment = {
          vertical: "top",
          wrapText: wrapKeys.includes(key),
          horizontal: centerKeys.includes(key) ? "center" : "left",
        }
      })
    })

    rows.forEach((row, index) => {
      for (const { key, severityOf } of severityKeys) {
        const columnIndex = columns.findIndex((c) => c.key === key)
        if (columnIndex < 0) continue
        const severity = severityOf(row)
        const cell = sheet.getCell(index + 2, columnIndex + 1)
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: SEVERITY_FILL_ARGB[severity] },
        }
        cell.font = {
          bold: true,
          color: { argb: SEVERITY_FONT_ARGB[severity] },
        }
      }
    })

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    }
  }

  addSheet(
    "Fault Register",
    [
      { header: "Date", key: "date", width: 12 },
      { header: "Fleet No.", key: "fleet", width: 11 },
      { header: "Gen", key: "gen", width: 9 },
      { header: "Fault Code", key: "code", width: 18 },
      { header: "Control Unit (ECU)", key: "ecu", width: 24 },
      { header: "State", key: "state", width: 11 },
      { header: "Count", key: "count", width: 8 },
      { header: "PTT Fault Description", key: "description", width: 44 },
      { header: "AI Severity", key: "severity", width: 18 },
      { header: "Cal. Req.", key: "cal", width: 10 },
      { header: "AI Fault Root Cause", key: "rootCause", width: 62 },
      {
        header: "AI Interventions Required (Directive)",
        key: "directive",
        width: 70,
      },
    ],
    faultRows.map((row) => ({
      date: row.scanDate,
      fleet: row.fleetId,
      gen: row.truckGeneration,
      code: row.faultCode,
      ecu: row.controlUnit,
      state: row.faultState,
      count: row.occurrenceCount,
      description: row.pttDescription,
      severity: SEVERITY_DISPLAY[row.aiSeverity],
      cal: row.calibrationRequired ? "Yes" : "No",
      rootCause: row.faultIntervention,
      directive: row.workshopDirectiveSummary,
      // Not a column: carried so the severity fill can read it back.
      severityTier: row.aiSeverity,
    })),
    ["ecu", "description", "rootCause", "directive"],
    ["gen", "state", "count", "severity", "cal"],
    [
      {
        key: "severity",
        severityOf: (row) => row.severityTier as PttOverallSeverity,
      },
    ]
  )

  addSheet(
    "Truck Directives",
    [
      { header: "Date", key: "date", width: 12 },
      { header: "Fleet No.", key: "fleet", width: 11 },
      { header: "Gen", key: "gen", width: 9 },
      { header: "Status", key: "status", width: 16 },
      { header: "Overall Severity", key: "overall", width: 18 },
      { header: "Total Faults", key: "total", width: 10 },
      { header: "Critical", key: "critical", width: 10 },
      { header: "Calibration", key: "calibration", width: 12 },
      { header: "Monitor", key: "monitor", width: 10 },
      { header: "Negligible", key: "negligible", width: 11 },
      { header: "True Diagnosis", key: "diagnosis", width: 50 },
      { header: "Parts Warning", key: "warning", width: 50 },
      { header: "Physical Checks", key: "checks", width: 60 },
      { header: "PTT Paths", key: "paths", width: 50 },
      { header: "Verification Criteria", key: "criteria", width: 50 },
    ],
    truckSummaryRows.map((row) => ({
      date: row.scanDate,
      fleet: row.fleetId,
      gen: row.truckGeneration,
      status: row.sessionStatus,
      overall: SEVERITY_DISPLAY[row.overallSeverity],
      total: row.totalFaults,
      critical: row.criticalFaults,
      calibration: row.calibrationFaults,
      monitor: row.monitorFaults,
      negligible: row.negligibleFaults,
      diagnosis: row.trueDiagnosis,
      warning: row.partsCannonWarning,
      checks: row.physicalInspections,
      paths: row.pttPaths,
      criteria: row.verificationCriteria,
      overallTier: row.overallSeverity,
    })),
    ["status", "diagnosis", "warning", "checks", "paths", "criteria"],
    [
      "gen",
      "overall",
      "total",
      "critical",
      "calibration",
      "monitor",
      "negligible",
    ],
    [
      {
        key: "overall",
        severityOf: (row) => row.overallTier,
      },
    ]
  )

  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(
    new Blob([buffer as ArrayBuffer], { type: EXCEL_MIME }),
    fileName(resolved, "xlsx", generatedAt)
  )
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const COMPANY = "MILOTO TRANSPORT LIMITED"
const COMPANY_SITE = "ZAMBEZI PORTLAND CEMENT"
const PDF_TITLE = "Fleet Diagnostics (PTT Intel) \u2014 Fault & Intervention Report"

type Rgb = [number, number, number]

const SEVERITY_PDF_FILL: Record<PttOverallSeverity, Rgb> = {
  CRITICAL: [254, 202, 202],
  CALIBRATION_ONLY: [233, 213, 255],
  MONITOR: [253, 230, 138],
  NEGLIGIBLE: [229, 231, 235],
  CLEAR: [209, 250, 229],
}

const SEVERITY_PDF_TEXT: Record<PttOverallSeverity, Rgb> = {
  CRITICAL: [153, 27, 27],
  CALIBRATION_ONLY: [107, 33, 168],
  MONITOR: [146, 64, 14],
  NEGLIGIBLE: [55, 65, 81],
  CLEAR: [6, 95, 70],
}

// jsPDF's built-in Helvetica only renders Latin-1 (+ a few Windows-1252
// punctuation marks). Map the arrows / comparison signs the AI likes to use,
// and drop anything else (emoji, symbols) instead of printing garbage.
function pdfText(value: string): string {
  return value
    .replace(/[\u2192\u21d2]/g, "->")
    .replace(/\u2190/g, "<-")
    .replace(/\u2265/g, ">=")
    .replace(/\u2264/g, "<=")
    .replace(/[\u2212]/g, "-")
    .replace(/[\u00a0\u2009\u202f]/g, " ")
    .replace(/[^\n\u0020-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g, "")
}

const EMPTY_CELL = "\u2014"

/**
 * Builds the A4 landscape report (header, KPI bar, fault table, then the
 * "Executive Truck Directives Summary" section) with `jspdf` +
 * `jspdf-autotable`, laid out like the HR disciplinary report, and downloads
 * it as `Miloto_PTT_Diagnostics_<Scope>_<YYYY-MM-DD>.pdf`.
 */
export function generatePttDiagnosticsPdf(
  sessions: readonly PttReportSession[],
  options?: Partial<PttReportFilterOptions>
): void {
  const resolved = resolveOptions(options)
  const { faultRows, truckSummaryRows, truckCount } = buildPttFaultReportRows(
    sessions,
    resolved
  )
  const generatedAt = new Date()

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 12

  // --- Header -------------------------------------------------------------
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.setTextColor(90, 90, 90)
  doc.text(`${COMPANY_SITE}  /  ${COMPANY}`, margin, 11)

  doc.setFontSize(16)
  doc.setTextColor(20, 20, 20)
  doc.text(PDF_TITLE, margin, 18)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(90, 90, 90)
  let subtitleY = 24
  for (const line of describeFilters(resolved)) {
    doc.text(pdfText(line), margin, subtitleY)
    subtitleY += 5
  }
  doc.text(
    `Generated: ${format(generatedAt, "dd MMM yyyy, HH:mm:ss")}`,
    margin,
    subtitleY
  )

  // --- KPI summary bar ----------------------------------------------------
  const countOf = (tier: PttFaultSeverity) =>
    faultRows.filter((row) => row.aiSeverity === tier).length
  const kpis: { label: string; value: number; tier?: PttOverallSeverity }[] = [
    { label: "Trucks", value: truckCount },
    { label: "Total Faults", value: faultRows.length },
    { label: "Critical", value: countOf("CRITICAL"), tier: "CRITICAL" },
    {
      label: "Calibration Only",
      value: countOf("CALIBRATION_ONLY"),
      tier: "CALIBRATION_ONLY",
    },
    { label: "Monitor", value: countOf("MONITOR"), tier: "MONITOR" },
  ]

  const barTop = subtitleY + 5
  const barHeight = 16
  const gap = 3
  const boxWidth =
    (pageWidth - margin * 2 - gap * (kpis.length - 1)) / kpis.length

  kpis.forEach((kpi, index) => {
    const x = margin + index * (boxWidth + gap)
    const highlighted = kpi.tier !== undefined && kpi.value > 0
    const fill = highlighted ? SEVERITY_PDF_FILL[kpi.tier!] : ([247, 247, 247] as Rgb)
    const text = highlighted ? SEVERITY_PDF_TEXT[kpi.tier!] : ([20, 20, 20] as Rgb)

    doc.setDrawColor(200, 200, 200)
    doc.setFillColor(...fill)
    doc.roundedRect(x, barTop, boxWidth, barHeight, 1.5, 1.5, "FD")

    doc.setFont("helvetica", "bold")
    doc.setFontSize(14)
    doc.setTextColor(...text)
    doc.text(String(kpi.value), x + 3, barTop + 8)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(90, 90, 90)
    doc.text(kpi.label, x + 3, barTop + 13)
  })

  // --- Section 1: fault & intervention table ---------------------------------
  const SEVERITY_COLUMN = 4
  autoTable(doc, {
    startY: barTop + barHeight + 6,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [
      [
        "Date",
        "Fleet No.",
        "Fault Code / ECU",
        "PTT Fault Description",
        "Severity",
        "AI Intervention Required",
      ],
    ],
    body: faultRows.map((row) => [
      row.scanDate,
      row.fleetId,
      pdfText(
        [
          row.faultCode,
          row.controlUnit,
          `${row.faultState}${row.occurrenceCount != null ? ` (x${row.occurrenceCount})` : ""}${row.calibrationRequired ? " | Cal. req." : ""}`,
        ].join("\n")
      ),
      pdfText(row.pttDescription) || EMPTY_CELL,
      SEVERITY_DISPLAY[row.aiSeverity],
      pdfText(row.faultIntervention) || EMPTY_CELL,
    ]),
    theme: "striped",
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2,
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 248, 250] },
    columnStyles: {
      0: { cellWidth: 21 },
      1: { cellWidth: 19 },
      2: { cellWidth: 50 },
      3: { cellWidth: 62 },
      4: { cellWidth: 26, halign: "center" },
      5: { cellWidth: "auto" },
    },
    rowPageBreak: "avoid",
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index !== SEVERITY_COLUMN) {
        return
      }
      const tier = faultRows[data.row.index]?.aiSeverity
      if (!tier) return
      data.cell.styles.fillColor = SEVERITY_PDF_FILL[tier]
      data.cell.styles.textColor = SEVERITY_PDF_TEXT[tier]
      data.cell.styles.fontStyle = "bold"
    },
  })

  // --- Section 2: executive truck directives summary --------------------------
  doc.addPage()
  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.setTextColor(20, 20, 20)
  doc.text("Executive Truck Directives Summary", margin, 16)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.setTextColor(90, 90, 90)
  doc.text(
    `${truckSummaryRows.length} ${truckSummaryRows.length === 1 ? "scan" : "scans"} across ${truckCount} ${truckCount === 1 ? "truck" : "trucks"} \u2014 workshop handover: what to check, where to navigate in PTT, and how to prove the fix.`,
    margin,
    21
  )

  autoTable(doc, {
    startY: 26,
    margin: { left: margin, right: margin, bottom: 16 },
    head: [
      [
        "Truck",
        "True Diagnosis",
        "Parts Warning",
        "Physical Checks",
        "PTT Paths",
        "Verification Criteria",
      ],
    ],
    body: truckSummaryRows.map((row) => [
      pdfText(
        [
          row.fleetId,
          `${row.truckGeneration} | ${row.scanDate}`,
          row.sessionStatus,
          `${SEVERITY_DISPLAY[row.overallSeverity]} (${row.totalFaults} ${row.totalFaults === 1 ? "fault" : "faults"})`,
          `C ${row.criticalFaults} | Cal ${row.calibrationFaults} | M ${row.monitorFaults} | N ${row.negligibleFaults}`,
        ].join("\n")
      ),
      pdfText(row.trueDiagnosis) || EMPTY_CELL,
      pdfText(row.partsCannonWarning) || EMPTY_CELL,
      pdfText(row.physicalInspections) || EMPTY_CELL,
      pdfText(row.pttPaths) || EMPTY_CELL,
      pdfText(row.verificationCriteria) || EMPTY_CELL,
    ]),
    theme: "striped",
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 2,
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 248, 250] },
    columnStyles: {
      0: { cellWidth: 34, fontStyle: "bold" },
      1: { cellWidth: 46 },
      2: { cellWidth: 46 },
      3: { cellWidth: 54 },
      4: { cellWidth: 44 },
      5: { cellWidth: "auto" },
    },
    rowPageBreak: "avoid",
    didParseCell: (data) => {
      if (data.section !== "body" || data.column.index !== 0) return
      const tier = truckSummaryRows[data.row.index]?.overallSeverity
      if (!tier) return
      data.cell.styles.fillColor = SEVERITY_PDF_FILL[tier]
      data.cell.styles.textColor = SEVERITY_PDF_TEXT[tier]
    },
  })

  // --- Footer on every page -----------------------------------------------
  const totalPages = doc.getNumberOfPages()
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(8)
    doc.setTextColor(120, 120, 120)
    doc.text(
      `Confidential \u2014 Miloto Transport Limited  |  Generated ${format(generatedAt, "dd MMM yyyy, HH:mm:ss")}`,
      margin,
      pageHeight - 7
    )
    doc.text(`Page ${page} of ${totalPages}`, pageWidth - margin, pageHeight - 7, {
      align: "right",
    })
  }

  doc.save(fileName(resolved, "pdf", generatedAt))
}
