import { format } from "date-fns"

import { formatIsoDate, parseIsoDate, toIsoDateParam } from "@/lib/iso-date"
import {
  STATEMENT_COMPONENT_GROUPS,
  type ManualStatementEventType,
} from "@/lib/spares-statement"
import { normalizeSubEquipment } from "@/lib/spreadsheet"

export const DIRECTOR_SUMMARY_EVENT_TYPES = [
  "Intervention",
  "Alignment",
  "Check",
] as const

export type DirectorSummaryEventType =
  (typeof DIRECTOR_SUMMARY_EVENT_TYPES)[number]

// Same ERP Sub Equipment labels the executive statement uses
// (`STATEMENT_COMPONENT_GROUPS` / `mechanicalSparesTable.subEquipment`),
// plus General for blank rows and routine checks, and Alignment for
// WHEEL_ALIGNMENT manual events. Print order puts the high-traffic
// mechanical groups first.
export const DIRECTOR_SUMMARY_SYSTEMS = [
  "General",
  "Engine",
  "Transmission",
  "Axles",
  "Alignment",
  "Suspension",
  "Diffs",
  "Air System",
  "Electrical",
  "Hydraulic System",
  "Cabin",
  "Body",
  "Chassis",
  "Compressor",
  "Aircon",
  "Service",
  "Overhauled Engine",
  "Overhauled Volvo Engine",
  "Overhauled Diff",
] as const satisfies readonly (
  | "General"
  | "Alignment"
  | (typeof STATEMENT_COMPONENT_GROUPS)[number]
)[]

export type DirectorSummarySystem = (typeof DIRECTOR_SUMMARY_SYSTEMS)[number]

const TRAILER_EXCLUDED_SYSTEMS = new Set<DirectorSummarySystem>([
  "Engine",
  "Transmission",
  "Diffs",
  "Hydraulic System",
  "Cabin",
  "Body",
  "Compressor",
  "Aircon",
  "Overhauled Engine",
  "Overhauled Volvo Engine",
  "Overhauled Diff",
])

export const DIRECTOR_SUMMARY_TRAILER_SYSTEMS = DIRECTOR_SUMMARY_SYSTEMS.filter(
  (system) => !TRAILER_EXCLUDED_SYSTEMS.has(system)
)

export function isDirectorSummaryPrimeMover(assetName: string) {
  return assetName.trim().toUpperCase().startsWith("MTL")
}

export function isDirectorSummaryTrailer(assetName: string) {
  const name = assetName.trim().toUpperCase()
  return name.startsWith("MT") && !name.startsWith("MTL")
}

export type DirectorSummarySpareInput = {
  assetName: string
  date: string | Date
  subEquipment: string | null
}

export type DirectorSummaryManualEventInput = {
  assetName: string
  date: string | Date
  eventType: string
}

export type DirectorSummaryCellEvent = {
  eventType: DirectorSummaryEventType
  latestDate: string
  formattedDate: string
  distinctDaysCount: number
}

export type DirectorSummaryRow = {
  assetName: string
  cells: Record<DirectorSummarySystem, DirectorSummaryCellEvent[]>
}

export type DirectorSummaryMatrixResult = {
  year: number
  month: number
  rows: DirectorSummaryRow[]
}

export type DirectorSummaryMatrixPayload = DirectorSummaryMatrixResult & {
  periodLabel: string
}

const MANUAL_EVENT_SYSTEM: Record<
  Extract<ManualStatementEventType, "WHEEL_ALIGNMENT" | "CHECKS_OK">,
  DirectorSummarySystem
> = {
  WHEEL_ALIGNMENT: "Alignment",
  CHECKS_OK: "General",
}

function emptyCells(): Record<DirectorSummarySystem, DirectorSummaryCellEvent[]> {
  const cells = {} as Record<DirectorSummarySystem, DirectorSummaryCellEvent[]>
  for (const system of DIRECTOR_SUMMARY_SYSTEMS) {
    cells[system] = []
  }
  return cells
}

function isDirectorSummarySystem(
  value: string
): value is DirectorSummarySystem {
  return (DIRECTOR_SUMMARY_SYSTEMS as readonly string[]).includes(value)
}

function isIsoDateInMonth(isoDate: string, year: number, month: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return false
  return Number(match[1]) === year && Number(match[2]) === month
}

function isFutureCalendarDate(isoDate: string, now = new Date()) {
  return isoDate > formatIsoDate(now)
}

// Drizzle `date` columns are YYYY-MM-DD; some drivers serialize them as
// midnight UTC timestamps. Slice to the calendar day so grouping stays
// timezone-safe.
function toCalendarDate(value: string | Date) {
  if (value instanceof Date) {
    const year = value.getUTCFullYear()
    const month = String(value.getUTCMonth() + 1).padStart(2, "0")
    const day = String(value.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  return toIsoDateParam(value.slice(0, 10))
}

function formatDayMonth(isoDate: string) {
  const parsed = parseIsoDate(isoDate)
  if (!parsed) return isoDate
  return format(parsed, "dd-MMM")
}

export function formatDirectorSummaryDate(
  isoDate: string,
  distinctDaysCount: number
) {
  const label = formatDayMonth(isoDate)
  if (distinctDaysCount > 1) return `${label} (x${distinctDaysCount})`
  return label
}

// Title-cases the raw ERP cell the same way the executive statement does.
// Known groups keep their own column; blank or unrecognised values land
// in General.
export function systemFromSubEquipment(
  subEquipment: string | null | undefined
): DirectorSummarySystem {
  const name = normalizeSubEquipment(subEquipment ?? "")
  if (name && isDirectorSummarySystem(name)) return name
  return "General"
}

function mapManualEvent(
  eventType: string
): { eventType: DirectorSummaryEventType; system: DirectorSummarySystem } | null {
  if (eventType === "WHEEL_ALIGNMENT") {
    return { eventType: "Alignment", system: MANUAL_EVENT_SYSTEM.WHEEL_ALIGNMENT }
  }
  if (eventType === "CHECKS_OK") {
    return { eventType: "Check", system: MANUAL_EVENT_SYSTEM.CHECKS_OK }
  }
  return null
}

type GroupAccumulator = {
  assetName: string
  system: DirectorSummarySystem
  eventType: DirectorSummaryEventType
  dates: Set<string>
}

function groupKey(
  assetName: string,
  system: DirectorSummarySystem,
  eventType: DirectorSummaryEventType
) {
  return `${assetName}\0${system}\0${eventType}`
}

function addOccurrence(
  groups: Map<string, GroupAccumulator>,
  assetName: string,
  system: DirectorSummarySystem,
  eventType: DirectorSummaryEventType,
  date: string
) {
  const name = assetName.trim()
  if (!name || !isDirectorSummarySystem(system)) return

  const key = groupKey(name, system, eventType)
  const existing = groups.get(key)
  if (existing) {
    existing.dates.add(date)
    return
  }

  groups.set(key, {
    assetName: name,
    system,
    eventType,
    dates: new Set([date]),
  })
}

function toCellEvent(dates: Set<string>, eventType: DirectorSummaryEventType) {
  const sorted = [...dates].sort()
  const latestDate = sorted[sorted.length - 1] ?? ""
  const distinctDaysCount = sorted.length

  return {
    eventType,
    latestDate,
    formattedDate: formatDirectorSummaryDate(latestDate, distinctDaysCount),
    distinctDaysCount,
  }
}

function eventTypeOrder(eventType: DirectorSummaryEventType) {
  return DIRECTOR_SUMMARY_EVENT_TYPES.indexOf(eventType)
}

export function aggregateDirectorSummaryMatrix(
  spares: DirectorSummarySpareInput[],
  manualEvents: DirectorSummaryManualEventInput[],
  year: number,
  month: number
): DirectorSummaryMatrixResult {
  const groups = new Map<string, GroupAccumulator>()

  for (const spare of spares) {
    const date = toCalendarDate(spare.date)
    if (!date || isFutureCalendarDate(date) || !isIsoDateInMonth(date, year, month)) {
      continue
    }
    addOccurrence(
      groups,
      spare.assetName,
      systemFromSubEquipment(spare.subEquipment),
      "Intervention",
      date
    )
  }

  for (const event of manualEvents) {
    const date = toCalendarDate(event.date)
    if (!date || isFutureCalendarDate(date) || !isIsoDateInMonth(date, year, month)) {
      continue
    }
    const mapped = mapManualEvent(event.eventType)
    if (!mapped) continue
    addOccurrence(
      groups,
      event.assetName,
      mapped.system,
      mapped.eventType,
      date
    )
  }

  const rowsByAsset = new Map<string, DirectorSummaryRow>()

  for (const group of groups.values()) {
    const row = rowsByAsset.get(group.assetName) ?? {
      assetName: group.assetName,
      cells: emptyCells(),
    }
    row.cells[group.system].push(toCellEvent(group.dates, group.eventType))
    rowsByAsset.set(group.assetName, row)
  }

  const rows = [...rowsByAsset.values()]
    .map((row) => {
      const cells = emptyCells()
      for (const system of DIRECTOR_SUMMARY_SYSTEMS) {
        cells[system] = [...row.cells[system]].sort(
          (left, right) =>
            eventTypeOrder(left.eventType) - eventTypeOrder(right.eventType)
        )
      }
      return { assetName: row.assetName, cells }
    })
    .sort(
      (left, right) =>
        left.assetName.localeCompare(right.assetName, undefined, {
          numeric: true,
        })
    )

  return { year, month, rows }
}
