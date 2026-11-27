import { format } from "date-fns"

import {
  compareFleetIds,
  normalizeFleetId,
  PTT_SEVERITY_RANK,
  type PttFaultSeverity,
  type PttTruckGeneration,
} from "../ptt-diagnostics"
import {
  buildPttReportData,
  daysBetween,
  endOfDay,
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
  | "Fault Clearance Pending"
  | "Not Scanned"

/** `FH V3` / `FH V4` / `\u2014` (not yet identified). */
export type WorksTrackerGeneration = "FH V3" | "FH V4" | "\u2014"

export const PENDING_RESIDUAL_TEXT = "Pending baseline scan"
export const PARTIAL_RESIDUAL_TEXT = "Awaiting final photo"
export const NONE_CLEARED_TRACKER_TEXT = "None cleared"
/** Residual Fault Codes placeholder when every actionable fault was cleared. */
export const NONE_RESIDUAL_TRACKER_TEXT = "None - All actionable faults cleared"

/** One cleared / residual fault line of a tracker row. */
export type WorksTrackerFaultItem = {
  /** `Code - Short Description` (ASCII hyphen, PDF safe). */
  text: string
  /** `MID128 PID94 FMI5` (FH V3) / `EMS P255800` (FH V4). */
  codeLabel: string
  ecuLabel: string
  severity: PttFaultSeverity
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
  /** Actionable faults on the BEFORE photo; `null` when PENDING. */
  openingFaultsCount: number | null
  clearedFaultsCount: number | null
  residualFaultsCount: number | null
  /** Structured cleared faults (COMPLETE only), severity -> ECU -> code. */
  clearedFaultItems: WorksTrackerFaultItem[]
  /**
   * Newline-separated `Code - Short Description` (COMPLETE), `None cleared`
   * when nothing was cleared, `""` for PARTIAL / PENDING.
   */
  clearedFaultCodes: string
  /** Structured residual faults of the final photo (COMPLETE only). */
  residualFaultItems: WorksTrackerFaultItem[]
  /**
   * Newline-separated `Code - Short Description` (COMPLETE with residuals),
   * or a placeholder (none left / awaiting final photo / pending baseline).
   */
  residualFaultCodes: string
  /**
   * `Closure: <reason>`, then the manager's note on a second line; only on a
   * COMPLETE row closed with accepted residuals.
   */
  closureNote: string | null
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
  totalResidualFaults: number
}

/** `STATUS`: Complete -> Partial -> Pending; `FLEET_NO`: strictly by Fleet No. */
export type WorksTrackerSortBy = "STATUS" | "FLEET_NO"

export type WorksTrackerOptions = {
  /** `ALL` or one normalized fleet number. */
  fleetId: string
  fromDate?: string
  toDate?: string
  /**
   * Always `true`: the director-facing tracker silently excludes approved
   * exceptions, whatever the UI toggle says.
   */
  excludeApprovedExceptions: boolean
  sortBy: WorksTrackerSortBy
}

/** The shared report options plus the tracker's row order. */
export type WorksTrackerBuildOptions = PttReportDataOptions & {
  sortBy?: WorksTrackerSortBy
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
  ].join("  |  ")
}

/** `Order: By Status` / `Order: Fleet No. (MTL01\u2013MTL149)`. */
export function describeWorksTrackerOrder(data: {
  options: Pick<WorksTrackerOptions, "sortBy">
  rows: readonly Pick<WorksTrackerRow, "fleetId">[]
}): string {
  if (data.options.sortBy === "STATUS") return "Order: By Status"
  const first = data.rows[0]
  const last = data.rows[data.rows.length - 1]
  return first && last
    ? `Order: Fleet No. (${first.fleetId}\u2013${last.fleetId})`
    : "Order: Fleet No."
}

/**
 * Natural Fleet No. comparator: numeric suffixes compare by value, with or
 * without leading zeros (`MTL01` < `MTL02` < `MTL09` < `MTL10` < `MTL100`).
 * Equal-valued ids (`MTL01` vs `MTL1`) fall back to the raw text so the order
 * is always deterministic.
 */
export function compareWorksTrackerFleetIds(a: string, b: string): number {
  return compareFleetIds(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

/** Compares by status priority, then natural Fleet No. (`MTL10` < `MTL100`). */
export function compareWorksTrackerRows(
  a: Pick<WorksTrackerRow, "trackerStatus" | "fleetId">,
  b: Pick<WorksTrackerRow, "trackerStatus" | "fleetId">
): number {
  return (
    STATUS_PRIORITY[a.trackerStatus] - STATUS_PRIORITY[b.trackerStatus] ||
    compareWorksTrackerFleetIds(a.fleetId, b.fleetId)
  )
}

/** Strictly by natural Fleet No., whatever the tracker status. */
export function compareWorksTrackerRowsByFleetNo(
  a: Pick<WorksTrackerRow, "fleetId">,
  b: Pick<WorksTrackerRow, "fleetId">
): number {
  return compareWorksTrackerFleetIds(a.fleetId, b.fleetId)
}

/** CRITICAL -> CALIBRATION_ONLY -> MONITOR, then ECU, then code. */
const compareFaultItems = (
  a: PttReportFaultItem,
  b: PttReportFaultItem
): number =>
  PTT_SEVERITY_RANK[b.severity] - PTT_SEVERITY_RANK[a.severity] ||
  a.ecuLabel.localeCompare(b.ecuLabel) ||
  a.canonicalKey.localeCompare(b.canonicalKey)

/** Typographic dashes -> ASCII hyphen, so the text is safe in any PDF font. */
const asciiDashes = (value: string): string =>
  value.replace(/[\u2013\u2014]/g, "-")

/** `Code - Short Description` (no repeat / regression / exception tags). */
function faultItemOf(item: PttReportFaultItem): WorksTrackerFaultItem {
  return {
    text: asciiDashes(`${item.codeLabel} - ${item.shortDescription}`),
    codeLabel: item.codeLabel,
    ecuLabel: item.ecuLabel,
    severity: item.severity,
  }
}

const sortedFaultItems = (
  items: readonly PttReportFaultItem[]
): WorksTrackerFaultItem[] =>
  [...items].sort(compareFaultItems).map(faultItemOf)

const joinLines = (items: readonly WorksTrackerFaultItem[]): string =>
  items.map((item) => item.text).join("\n")

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
 * - Approved exceptions are ALWAYS silently excluded, whatever
 *   `excludeApprovedExceptions` says, so every count equals the number of
 *   fault lines printed next to it (never annotated).
 * - Residual faults are every active actionable fault of the final photo
 *   (regressions included, never labelled); cleared faults are the ones the
 *   final photo no longer shows. Both are sorted by severity, ECU, code.
 * - `sortBy` (default `STATUS`): status priority then natural Fleet No., or
 *   strictly natural Fleet No.
 */
export function buildWorksTrackerData(
  input: PttWorksTrackerInput,
  options?: WorksTrackerBuildOptions,
  now: Date = new Date()
): WorksTrackerData {
  const resolved = resolvePttReportOptions(options)
  const trackerOptions: WorksTrackerOptions = {
    fleetId: resolved.fleetId,
    fromDate: resolved.fromDate,
    toDate: resolved.toDate,
    excludeApprovedExceptions: true,
    sortBy: options?.sortBy ?? "STATUS",
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
    excludeApprovedExceptions: true,
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
        residualFaultsCount: null,
        clearedFaultItems: [],
        clearedFaultCodes: "",
        residualFaultItems: [],
        residualFaultCodes: PENDING_RESIDUAL_TEXT,
        closureNote: null,
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
        closureOutcome: "Fault Clearance Pending",
        beforePhotoDate,
        afterPhotoDate: null,
        turnaroundDays: Math.max(0, daysBetween(session.scannedAt, now)),
        openingFaultsCount,
        clearedFaultsCount: null,
        residualFaultsCount: null,
        clearedFaultItems: [],
        clearedFaultCodes: "",
        residualFaultItems: [],
        residualFaultCodes: PARTIAL_RESIDUAL_TEXT,
        closureNote: null,
      })
      continue
    }

    // COMPLETE: the latest verification scan is the final photo.
    // Counts are the lengths of the printed lists, so a number never
    // disagrees with the lines next to it (approved exceptions never appear).
    const clearedFaultItems = sortedFaultItems(finalTruck?.clearedItems ?? [])
    const residualFaultItems = sortedFaultItems(finalTruck?.outstandingItems ?? [])
    const clearedFaultsCount = clearedFaultItems.length
    const residualFaultsCount = residualFaultItems.length
    const acceptedResiduals =
      finalTruck?.caseStatus === "CLOSED_ACCEPTED_RESIDUALS"

    // The tracker status stays COMPLETE (both photos exist); the outcome says
    // HOW the job ended. A manager release is never a "Clean Closure", even
    // when its residuals were saved as exceptions (residual faults = 0).
    const closureOutcome: WorksTrackerOutcome = acceptedResiduals
      ? "Closed (Accepted Residuals)"
      : residualFaultsCount === 0
        ? "Clean Closure"
        : finalTruck?.caseStatus === "REJECTED_NO_PROGRESS"
          ? "No Progress"
          : "Residual Faults"
    const closureNote =
      acceptedResiduals && finalTruck
        ? [
            `Closure: ${finalTruck.closureReasonLabel ?? ""}`.replace(/:\s*$/, ""),
            finalTruck.closureNote ?? "",
          ]
            .filter(Boolean)
            .map(asciiDashes)
            .join("\n")
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
      residualFaultsCount,
      clearedFaultItems,
      clearedFaultCodes:
        clearedFaultsCount === 0
          ? NONE_CLEARED_TRACKER_TEXT
          : joinLines(clearedFaultItems),
      residualFaultItems,
      residualFaultCodes:
        residualFaultsCount === 0
          ? NONE_RESIDUAL_TRACKER_TEXT
          : joinLines(residualFaultItems),
      closureNote,
    })
  }

  rows.sort(
    trackerOptions.sortBy === "FLEET_NO"
      ? compareWorksTrackerRowsByFleetNo
      : compareWorksTrackerRows
  )

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
        row.residualFaultsCount === 0 &&
        row.closureOutcome !== "Closed (Accepted Residuals)"
    ).length,
    closedAcceptedResidualsCount: complete.filter(
      (row) => row.closureOutcome === "Closed (Accepted Residuals)"
    ).length,
    residualFaultsTrucksCount: complete.filter(
      (row) =>
        (row.residualFaultsCount ?? 0) >= 1 &&
        row.closureOutcome !== "Closed (Accepted Residuals)"
    ).length,
    totalClearedFaults: sum((row) => row.clearedFaultsCount),
    totalResidualFaults: sum((row) => row.residualFaultsCount),
  }

  return { options: trackerOptions, generatedAt: now, rows, kpis }
}
