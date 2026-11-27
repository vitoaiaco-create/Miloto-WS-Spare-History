import { format } from "date-fns"

import {
  compareFleetIds,
  normalizeFleetId,
  type PttTruckGeneration,
} from "../ptt-diagnostics"
import {
  ALL_CLEARED_TEXT,
  buildPttReportData,
  daysBetween,
  endOfDay,
  formatFaultLine,
  formatOutstandingLine,
  latestScanAt,
  newestVerificationFirst,
  resolvePttReportOptions,
  startOfDay,
  type PttReportCase,
  type PttReportDataOptions,
  type PttReportFaultItem,
  type PttReportInput,
  type PttReportTruck,
} from "./report-data"

// Fleet Diagnostic Works Tracker: one row per ACTIVE truck showing how far the
// diagnostic sweep has got (PENDING -> PARTIAL -> COMPLETE). Pure and
// client-safe, like `report-data.ts`, and built on top of it: every fault
// count and list comes from `buildPttReportData`, so the tracker can never
// disagree with the Fault Report, the Executive Directives or the workbook.
// The PDF and the Excel workbook both render the same `WorksTrackerData`.

/** A truck of the active fleet roster (the Fleet No. selector's source). */
export type PttWorksTrackerRosterTruck = {
  fleetId: string
  generation: PttTruckGeneration
}

export type PttWorksTrackerInput = PttReportInput & {
  /** Full active fleet; unioned with every `fleetId` that has a session. */
  roster: readonly PttWorksTrackerRosterTruck[]
}

export type WorksTrackerStatus = "COMPLETE" | "PARTIAL" | "PENDING"

export type WorksTrackerOutcome =
  | "Clean Closure"
  | "Closed (Accepted Residuals)"
  | "Residual Faults"
  | "No Progress"
  | "In Workshop"
  | "Not Scanned"

/** `FH V3` / `FH V4` / `\u2014` (not yet identified). */
export type WorksTrackerGeneration = "FH V3" | "FH V4" | "\u2014"

export const PENDING_CLOSING_TEXT = "Pending baseline scan"
export const PARTIAL_CLOSING_TEXT = "Awaiting final photo"
export const NONE_CLEARED_TRACKER_TEXT = "None cleared"
/** Closing Fault Codes placeholder when a manager closed the job with residuals accepted. */
export const ACCEPTED_CLOSING_TEXT = "None \u2014 residuals accepted"
/** One line of the Closing Fault Codes cell, with the flags the PDF styles. */
export type WorksTrackerClosingFault = {
  /** `[NEW REGRESSION] [REPEAT x2] Code \u2014 Short Description`. */
  text: string
  isNewRegression: boolean
  /** `N` of `[REPEAT xN]`; 0 when the fault is not a repeat. */
  repeatCount: number
  /** Only listed when approved exceptions are NOT excluded. */
  isApprovedException: boolean
}

export type WorksTrackerRow = {
  fleetId: string
  generation: WorksTrackerGeneration
  trackerStatus: WorksTrackerStatus
  closureOutcome: WorksTrackerOutcome
  /** `YYYY-MM-DD` of the baseline scan, or `null` when there is none. */
  beforePhotoDate: string | null
  /** `YYYY-MM-DD` of the final verification scan, or `null`. */
  afterPhotoDate: string | null
  /** COMPLETE: baseline -> final photo. PARTIAL: days in the workshop. */
  turnaroundDays: number | null
  openingFaultsCount: number | null
  clearedFaultsCount: number | null
  closingFaultsCount: number | null
  newRegressionsCount: number | null
  approvedExceptionsCount: number
  /** Newline-separated `Code \u2014 Short Description`, or a status placeholder. */
  closingFaultCodes: string
  /** Structured lines behind `closingFaultCodes` (COMPLETE with faults only). */
  closingFaults: WorksTrackerClosingFault[]
  /** `+N approved exceptions excluded`; only on COMPLETE when excluding. */
  approvedExceptionsNote: string | null
  /** `Closure: <reason> \u2014 <note>`; only on a COMPLETE row closed with accepted residuals. */
  closureNote: string | null
  /** Newline-separated cleared faults (COMPLETE); `""` otherwise. */
  clearedFaultCodes: string
}

export type WorksTrackerKpis = {
  totalFleet: number
  completeCount: number
  completePct: number
  partialCount: number
  partialPct: number
  pendingCount: number
  pendingPct: number
  /** COMPLETE rows whose outcome is Clean Closure. */
  cleanClosureCount: number
  /** COMPLETE rows a manager closed with accepted residual faults. */
  closedAcceptedResidualsCount: number
  /** COMPLETE rows still open with residual faults (never a manager release). */
  residualFaultsTrucksCount: number
  totalClearedFaults: number
  totalClosingActionableFaults: number
  totalNewRegressions: number
}

export type WorksTrackerOptions = {
  /** `ALL` or one normalized fleet number. */
  fleetId: string
  fromDate?: string
  toDate?: string
  excludeApprovedExceptions: boolean
}

export type WorksTrackerData = {
  options: WorksTrackerOptions
  generatedAt: Date
  rows: WorksTrackerRow[]
  kpis: WorksTrackerKpis
}

const STATUS_PRIORITY: Record<WorksTrackerStatus, number> = {
  COMPLETE: 0,
  PARTIAL: 1,
  PENDING: 2,
}

const GENERATION_DISPLAY: Record<PttTruckGeneration, WorksTrackerGeneration> = {
  FH_V3: "FH V3",
  FH_V4: "FH V4",
  UNKNOWN: "\u2014",
}

const formatDate = (date: Date): string => format(date, "yyyy-MM-dd")

const percentOf = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0

/** `Miloto_PTT_Works_Tracker_<YYYY-MM-DD>.<pdf|xlsx>`. */
export function pttWorksTrackerFileName(
  extension: "pdf" | "xlsx",
  generatedAt: Date
): string {
  return `Miloto_PTT_Works_Tracker_${formatDate(generatedAt)}.${extension}`
}

/** Active filters, as the PDF subtitle / Excel summary print them. */
export function describeWorksTrackerFilters(
  options: WorksTrackerOptions
): string {
  const fmt = (value: string) =>
    format(new Date(`${value}T00:00:00`), "dd MMM yyyy")
  const { fromDate, toDate } = options
  const scope =
    fromDate && toDate
      ? `${fmt(fromDate)} to ${fmt(toDate)}`
      : fromDate
        ? `From ${fmt(fromDate)}`
        : toDate
          ? `Up to ${fmt(toDate)}`
          : "All dates"
  return [
    `Date scope: ${scope}`,
    `Truck: ${options.fleetId === "ALL" ? "All active trucks" : options.fleetId}`,
    `Approved exceptions: ${options.excludeApprovedExceptions ? "excluded" : "included"}`,
  ].join("  |  ")
}

/** Compares by status priority, then natural Fleet No. (`MTL10` < `MTL100`). */
export function compareWorksTrackerRows(
  a: Pick<WorksTrackerRow, "trackerStatus" | "fleetId">,
  b: Pick<WorksTrackerRow, "trackerStatus" | "fleetId">
): number {
  return (
    STATUS_PRIORITY[a.trackerStatus] - STATUS_PRIORITY[b.trackerStatus] ||
    compareFleetIds(a.fleetId, b.fleetId)
  )
}

function closingFaultOf(item: PttReportFaultItem): WorksTrackerClosingFault {
  return {
    text: formatOutstandingLine(item),
    isNewRegression: item.status === "NEW_REGRESSION",
    repeatCount: item.repeatCount,
    isApprovedException: false,
  }
}

/** The same case with its re-scans removed: what the BASELINE photo showed. */
function baselineView(session: PttReportCase): PttReportCase {
  return {
    ...session,
    verificationScans: [],
    verificationSummary: null,
    // The legacy re-scan flag must not hide a fault the baseline had open.
    faults: session.faults.map((fault) => ({ ...fault, resolvedOnRescan: false })),
  }
}

/**
 * Builds the tracker rows + KPIs.
 *
 * - The roster is unioned with every `fleetId` that has a session, so a scanned
 *   truck is never dropped; a `fleetId` filter narrows both.
 * - The `severity` filter never applies: PENDING trucks have no faults yet.
 * - With a date window, a truck's session is its newest one whose baseline OR
 *   latest verification scan falls inside it; none -> PENDING.
 * - `excludeApprovedExceptions` (default `true`) keeps approved exceptions out
 *   of the Closing Fault Codes and counts them for the muted footer note.
 */
export function buildWorksTrackerData(
  input: PttWorksTrackerInput,
  options?: PttReportDataOptions,
  now: Date = new Date()
): WorksTrackerData {
  const resolved = resolvePttReportOptions(options)
  const trackerOptions: WorksTrackerOptions = {
    fleetId: resolved.fleetId,
    fromDate: resolved.fromDate,
    toDate: resolved.toDate,
    excludeApprovedExceptions: resolved.excludeApprovedExceptions,
  }
  const fromMs = startOfDay(resolved.fromDate)
  const toMs = endOfDay(resolved.toDate)
  const inWindow = (date: Date): boolean => {
    const time = date.getTime()
    return (fromMs === null || time >= fromMs) && (toMs === null || time <= toMs)
  }

  // --- Master roster: active fleet + every scanned truck ---------------------
  const rosterGeneration = new Map<string, PttTruckGeneration>()
  for (const truck of input.roster) {
    const fleetId = normalizeFleetId(truck.fleetId)
    if (fleetId) rosterGeneration.set(fleetId, truck.generation)
  }
  const sessionsByFleet = new Map<string, PttReportCase[]>()
  for (const session of input.sessions) {
    const fleetId = normalizeFleetId(session.fleetId)
    if (!fleetId) continue
    const list = sessionsByFleet.get(fleetId)
    if (list) list.push(session)
    else sessionsByFleet.set(fleetId, [session])
  }
  const fleetIds = new Set<string>([
    ...rosterGeneration.keys(),
    ...sessionsByFleet.keys(),
  ])
  if (resolved.fleetId !== "ALL") {
    for (const fleetId of [...fleetIds]) {
      if (fleetId !== resolved.fleetId) fleetIds.delete(fleetId)
    }
  }

  // --- Pick each truck's session (newest inside the date window) ------------
  const newestFirst = (a: PttReportCase, b: PttReportCase): number =>
    latestScanAt(b).getTime() - latestScanAt(a).getTime() || b.id - a.id

  const chosen = new Map<string, PttReportCase>()
  const generationOf = new Map<string, PttTruckGeneration>()
  for (const fleetId of fleetIds) {
    const all = [...(sessionsByFleet.get(fleetId) ?? [])].sort(newestFirst)
    const inside = all.filter((session) => {
      const latestVerification = newestVerificationFirst(
        session.verificationScans
      )[0]
      return (
        inWindow(session.scannedAt) ||
        (latestVerification !== undefined &&
          inWindow(latestVerification.scannedAt))
      )
    })
    const session = inside[0]
    if (session) chosen.set(fleetId, session)

    // Generation: the chosen case, any other scan, then the roster.
    const known =
      [session, ...all].find(
        (candidate) =>
          candidate !== undefined && candidate.truckGeneration !== "UNKNOWN"
      )?.truckGeneration ?? rosterGeneration.get(fleetId)
    generationOf.set(fleetId, known ?? "UNKNOWN")
  }

  // --- Reuse the shared report engine for every number and fault list -------
  // `ALL_SCANS` + all severities + no date filter = exactly the chosen cases.
  const chosenSessions = [...chosen.values()]
  const engineOptions: PttReportDataOptions = {
    scope: "ALL_SCANS",
    fleetId: "ALL",
    excludeApprovedExceptions: resolved.excludeApprovedExceptions,
  }
  const finalTrucks = new Map<number, PttReportTruck>(
    buildPttReportData(
      { sessions: chosenSessions, ledger: input.ledger, exceptions: input.exceptions },
      engineOptions,
      now
    ).trucks.map((truck) => [truck.sessionId, truck])
  )
  const baselineTrucks = new Map<number, PttReportTruck>(
    buildPttReportData(
      {
        sessions: chosenSessions.map(baselineView),
        ledger: input.ledger,
        exceptions: input.exceptions,
      },
      engineOptions,
      now
    ).trucks.map((truck) => [truck.sessionId, truck])
  )

  const rows: WorksTrackerRow[] = []
  for (const fleetId of fleetIds) {
    const generation = GENERATION_DISPLAY[generationOf.get(fleetId) ?? "UNKNOWN"]
    const session = chosen.get(fleetId)

    if (!session) {
      rows.push({
        fleetId,
        generation,
        trackerStatus: "PENDING",
        closureOutcome: "Not Scanned",
        beforePhotoDate: null,
        afterPhotoDate: null,
        turnaroundDays: null,
        openingFaultsCount: null,
        clearedFaultsCount: null,
        closingFaultsCount: null,
        newRegressionsCount: null,
        approvedExceptionsCount: 0,
        closingFaultCodes: PENDING_CLOSING_TEXT,
        closingFaults: [],
        approvedExceptionsNote: null,
        closureNote: null,
        clearedFaultCodes: "",
      })
      continue
    }

    const finalPhoto = newestVerificationFirst(session.verificationScans)[0]
    const finalTruck = finalTrucks.get(session.id)
    const openingFaultsCount =
      baselineTrucks.get(session.id)?.outstandingCount ?? 0
    const beforePhotoDate = formatDate(session.scannedAt)

    if (!finalPhoto) {
      rows.push({
        fleetId,
        generation,
        trackerStatus: "PARTIAL",
        closureOutcome: "In Workshop",
        beforePhotoDate,
        afterPhotoDate: null,
        turnaroundDays: Math.max(0, daysBetween(session.scannedAt, now)),
        openingFaultsCount,
        clearedFaultsCount: null,
        closingFaultsCount: null,
        newRegressionsCount: null,
        approvedExceptionsCount:
          baselineTrucks.get(session.id)?.approvedExceptionsCount ?? 0,
        closingFaultCodes: PARTIAL_CLOSING_TEXT,
        closingFaults: [],
        approvedExceptionsNote: null,
        closureNote: null,
        clearedFaultCodes: "",
      })
      continue
    }

    // COMPLETE: the latest verification scan is the final photo.
    const closingFaultsCount = finalTruck?.outstandingCount ?? 0
    const newRegressionsCount = finalTruck?.newRegressionsCount ?? 0
    const clearedFaultsCount = finalTruck?.clearedCount ?? 0
    const approvedExceptionsCount = finalTruck?.approvedExceptionsCount ?? 0

    const closingFaults = (finalTruck?.outstandingItems ?? []).map(
      closingFaultOf
    )
    if (!resolved.excludeApprovedExceptions) {
      for (const item of finalTruck?.faults ?? []) {
        if (item.status !== "APPROVED_EXCEPTION") continue
        closingFaults.push({
          text: `[APPROVED EXCEPTION] ${formatFaultLine(item)}`,
          isNewRegression: false,
          repeatCount: 0,
          isApprovedException: true,
        })
      }
    }
    const acceptedResiduals =
      finalTruck?.caseStatus === "CLOSED_ACCEPTED_RESIDUALS"
    const closingLines =
      closingFaultsCount === 0
        ? [
            acceptedResiduals ? ACCEPTED_CLOSING_TEXT : ALL_CLEARED_TEXT,
            ...closingFaults.map((fault) => fault.text),
          ]
        : closingFaults.map((fault) => fault.text)

    // The tracker status stays COMPLETE (both photos exist); the outcome says
    // HOW the job ended. A manager release is never a "Clean Closure", even
    // when its residuals were saved as exceptions (closing faults = 0).
    const closureOutcome: WorksTrackerOutcome = acceptedResiduals
      ? "Closed (Accepted Residuals)"
      : closingFaultsCount === 0 && newRegressionsCount === 0
        ? "Clean Closure"
        : finalTruck?.caseStatus === "REJECTED_NO_PROGRESS"
          ? "No Progress"
          : "Residual Faults"
    const closureNote =
      acceptedResiduals && finalTruck
        ? `Closure: ${[finalTruck.closureReasonLabel, finalTruck.closureNote]
            .filter(Boolean)
            .join(" \u2014 ")}`.replace(/:\s*$/, "")
        : null

    rows.push({
      fleetId,
      generation,
      trackerStatus: "COMPLETE",
      closureOutcome,
      beforePhotoDate,
      afterPhotoDate: formatDate(finalPhoto.scannedAt),
      turnaroundDays: Math.max(
        0,
        daysBetween(session.scannedAt, finalPhoto.scannedAt)
      ),
      openingFaultsCount,
      clearedFaultsCount,
      closingFaultsCount,
      newRegressionsCount,
      approvedExceptionsCount,
      closingFaultCodes: closingLines.join("\n"),
      closingFaults,
      approvedExceptionsNote:
        resolved.excludeApprovedExceptions && approvedExceptionsCount > 0
          ? `+${approvedExceptionsCount} approved ${approvedExceptionsCount === 1 ? "exception" : "exceptions"} excluded`
          : null,
      closureNote,
      clearedFaultCodes:
        clearedFaultsCount === 0
          ? NONE_CLEARED_TRACKER_TEXT
          : (finalTruck?.clearedItems ?? []).map(formatFaultLine).join("\n"),
    })
  }

  rows.sort(compareWorksTrackerRows)

  const count = (status: WorksTrackerStatus) =>
    rows.filter((row) => row.trackerStatus === status).length
  const complete = rows.filter((row) => row.trackerStatus === "COMPLETE")
  const totalFleet = rows.length
  const completeCount = count("COMPLETE")
  const partialCount = count("PARTIAL")
  const pendingCount = count("PENDING")
  const sum = (pick: (row: WorksTrackerRow) => number | null) =>
    rows.reduce((total, row) => total + (pick(row) ?? 0), 0)

  const kpis: WorksTrackerKpis = {
    totalFleet,
    completeCount,
    completePct: percentOf(completeCount, totalFleet),
    partialCount,
    partialPct: percentOf(partialCount, totalFleet),
    pendingCount,
    pendingPct: percentOf(pendingCount, totalFleet),
    // Clean + Closed (Accepted Residuals) + Open with Residual Faults always
    // add up to Complete (the Excel summary uses the same three criteria).
    cleanClosureCount: complete.filter(
      (row) =>
        row.closingFaultsCount === 0 &&
        row.closureOutcome !== "Closed (Accepted Residuals)"
    ).length,
    closedAcceptedResidualsCount: complete.filter(
      (row) => row.closureOutcome === "Closed (Accepted Residuals)"
    ).length,
    residualFaultsTrucksCount: complete.filter(
      (row) =>
        (row.closingFaultsCount ?? 0) >= 1 &&
        row.closureOutcome !== "Closed (Accepted Residuals)"
    ).length,
    totalClearedFaults: sum((row) => row.clearedFaultsCount),
    totalClosingActionableFaults: sum((row) => row.closingFaultsCount),
    totalNewRegressions: sum((row) => row.newRegressionsCount),
  }

  return { options: trackerOptions, generatedAt: now, rows, kpis }
}
