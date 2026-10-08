import { format } from "date-fns"

import { parseIsoDate, toIsoDateParam } from "@/lib/iso-date"
import type { ManualStatementEventType } from "@/lib/spares-statement"

export const DIRECTOR_SUMMARY_EVENT_TYPES = [
  "Intervention",
  "Alignment",
  "Check",
] as const

export type DirectorSummaryEventType =
  (typeof DIRECTOR_SUMMARY_EVENT_TYPES)[number]

// Director-facing sub-equipment columns. Master Dictionary tier 1/2 paths
// collapse into this shorter list so Engine stays split from Transmission
// and Brakes stay split from Air System on the printed matrix.
export const DIRECTOR_SUMMARY_SYSTEMS = [
  "General",
  "Engine",
  "Transmission",
  "Axles & Suspension",
  "Brakes",
  "Air System",
  "Electrical",
  "Hydraulics",
  "Cabin & Body",
  "Chassis",
  "Service",
] as const

export type DirectorSummarySystem = (typeof DIRECTOR_SUMMARY_SYSTEMS)[number]

export type DirectorSummarySpareInput = {
  assetName: string
  date: string | Date
  tier1: string | null
  tier2: string | null
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

const TIER2_SYSTEM_MAP: Record<string, DirectorSummarySystem> = {
  "Engine Mechanicals": "Engine",
  "Fuel & Air Induction": "Engine",
  "Cooling System": "Engine",
  "Drivetrain & Transmission": "Transmission",
  "Cabin Components & HVAC": "Cabin & Body",
  "Body, Glass & Mirrors": "Cabin & Body",
  "Structural Chassis & Towing": "Chassis",
  "Axles & Hubs": "Axles & Suspension",
  "Steering Components": "Axles & Suspension",
  "Suspension Systems": "Axles & Suspension",
  "Foundation Brakes": "Brakes",
  "Brake Actuation & Control": "Brakes",
  "Air Lines & Fittings": "Air System",
  "Hydraulic Pumps & Motors": "Hydraulics",
  "Cylinders & Rams": "Hydraulics",
  "Hydraulic Lines & Fittings": "Hydraulics",
  "Service Parts": "Service",
  "Fasteners & Hardware": "General",
  "Workshop & General": "General",
  "Starting & Charging": "Electrical",
  "Lighting & Signage": "Electrical",
  "Sensors & Wiring": "Electrical",
}

const TIER1_SYSTEM_MAP: Record<string, DirectorSummarySystem> = {
  "1. ENGINE & POWERTRAIN": "Engine",
  "2. CABIN, BODY & CHASSIS": "Cabin & Body",
  "3. SUSPENSION, STEERING & AXLES": "Axles & Suspension",
  "4. BRAKES & PNEUMATICS": "Brakes",
  "5. HYDRAULICS": "Hydraulics",
  "6. CONSUMABLES, SERVICE & WEAR": "General",
  "7. ELECTRICAL & INSTRUMENTATION": "Electrical",
}

const MANUAL_EVENT_SYSTEM: Record<
  Extract<ManualStatementEventType, "WHEEL_ALIGNMENT" | "CHECKS_OK">,
  DirectorSummarySystem
> = {
  WHEEL_ALIGNMENT: "Axles & Suspension",
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

// Collapses a Master Dictionary path onto one printed system column.
// Tier 2 wins when it is a known child of `FLEET_TAXONOMY`; otherwise the
// Tier 1 group is used. Unknown paths land in General.
export function mapTaxonomyToSystem(
  tier1: string | null | undefined,
  tier2: string | null | undefined
): DirectorSummarySystem {
  const trimmedTier1 = tier1?.trim() ?? ""
  const trimmedTier2 = tier2?.trim() ?? ""

  if (trimmedTier2 && TIER2_SYSTEM_MAP[trimmedTier2]) {
    return TIER2_SYSTEM_MAP[trimmedTier2]
  }

  if (trimmedTier1 && TIER1_SYSTEM_MAP[trimmedTier1]) {
    return TIER1_SYSTEM_MAP[trimmedTier1]
  }

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
    if (!date || !isIsoDateInMonth(date, year, month)) continue
    addOccurrence(
      groups,
      spare.assetName,
      mapTaxonomyToSystem(spare.tier1, spare.tier2),
      "Intervention",
      date
    )
  }

  for (const event of manualEvents) {
    const date = toCalendarDate(event.date)
    if (!date || !isIsoDateInMonth(date, year, month)) continue
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
