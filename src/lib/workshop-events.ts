// Shared (client + server safe) constants and helpers for the Workshop
// Events module. Server Actions live in src/actions/workshop-events.ts.

export const WORKSHOP_EVENT_CATEGORIES = [
  "Wheel Alignment",
  "Air System Check",
] as const
export type WorkshopEventCategory = (typeof WORKSHOP_EVENT_CATEGORIES)[number]

export const AIR_SYSTEM_TEST_OK = "PREVENTATIVE MAINT - AIR SYSTEM TEST OK"
export const AIR_SYSTEM_TEST_FAILED =
  "PREVENTATIVE MAINT - AIR SYSTEM TEST FAILED"
export const ALIGNMENT_COMPLETED = "COMPLETED"

// The only outcomes each category may record. Enforced by Zod in the Server
// Actions and used to drive the technician form's Outcome select.
export const WORKSHOP_EVENT_OUTCOMES: Record<
  WorkshopEventCategory,
  readonly string[]
> = {
  "Wheel Alignment": [ALIGNMENT_COMPLETED],
  "Air System Check": [AIR_SYSTEM_TEST_OK, AIR_SYSTEM_TEST_FAILED],
}

// Compliance status shown to admins for one asset in the selected window.
export const COMPLIANCE_STATUSES = ["PENDING", "OK", "FAILED"] as const
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number]

// Derives the compliance status from an asset's most recent event in the
// window. FAILED is checked before OK so a failed test can never be read as
// passing; no event (or an unrecognised outcome) stays PENDING.
export function getComplianceStatus(
  lastEventDate: Date | null,
  lastEventOutcome: string | null
): ComplianceStatus {
  if (!lastEventDate || !lastEventOutcome) return "PENDING"

  const outcome = lastEventOutcome.toUpperCase()
  if (outcome.includes("FAILED")) return "FAILED"
  if (outcome.includes("OK") || outcome.includes("COMPLETED")) return "OK"
  return "PENDING"
}

export const WORKSHOP_EVENT_ASSET_TYPES = ["Truck", "Trailer"] as const
export type WorkshopEventAssetType =
  (typeof WORKSHOP_EVENT_ASSET_TYPES)[number]

export type WorkshopEventAssetOption = {
  id: number
  assetName: string
  assetType: WorkshopEventAssetType
}

export type WorkshopEventRow = {
  id: number
  assetId: number
  assetName: string
  assetType: WorkshopEventAssetType | null
  eventCategory: WorkshopEventCategory
  eventOutcome: string
  createdAt: Date
  createdBy: string
  // Display name of `createdBy`; falls back to the raw Clerk id when the
  // user can't be resolved.
  createdByName: string
  // True when the current user may undo this event (admin or original
  // author). Every row returned by `getTodayEvents` was created today.
  canDelete: boolean
}

// One asset's most recent event of the chosen category inside the window.
// Both `last*` fields are null when the asset has no event in the window.
export type FleetComplianceRow = {
  assetId: number
  assetName: string
  lastEventDate: Date | null
  lastEventOutcome: string | null
}

// Clerk `sessionClaims.metadata.role` values this module cares about.
export const WORKSHOP_ADMIN_ROLE = "admin"
export const WORKSHOP_TECHNICIAN_ROLE = "workshop_technician"

export function isWorkshopAdmin(role: string | undefined) {
  return role === WORKSHOP_ADMIN_ROLE
}

// Who may log / view / undo events on the technician page.
export function canUseWorkshopEvents(role: string | undefined) {
  return role === WORKSHOP_ADMIN_ROLE || role === WORKSHOP_TECHNICIAN_ROLE
}

// The workshop runs on Zambian time (UTC+2, no DST). "Today" and every
// displayed date use this zone so they don't shift with the server's (often
// UTC) clock or the viewer's browser zone.
export const WORKSHOP_TIME_ZONE = "Africa/Lusaka"

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

// Calendar day (`YYYY-MM-DD`) of an instant in the workshop zone.
export function toWorkshopDay(instant: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: WORKSHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant)
}

// Offset (ms) of the workshop zone from UTC at the given instant.
function workshopOffsetMs(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WORKSHOP_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant)
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value)
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  )
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

// The instant at which a workshop calendar day (`YYYY-MM-DD`) starts.
// Returns null for a malformed or impossible date.
export function workshopDayStart(day: string): Date | null {
  const match = ISO_DAY.exec(day)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const date = Number(match[3])
  const utcMidnight = new Date(Date.UTC(year, month - 1, date))
  if (
    utcMidnight.getUTCFullYear() !== year ||
    utcMidnight.getUTCMonth() !== month - 1 ||
    utcMidnight.getUTCDate() !== date
  ) {
    return null
  }

  return new Date(utcMidnight.getTime() - workshopOffsetMs(utcMidnight))
}

// [start, end) of the workshop day containing `instant`.
export function getWorkshopDayBounds(instant: Date = new Date()) {
  const start = workshopDayStart(toWorkshopDay(instant))
  if (!start) throw new Error("Could not resolve the workshop day")

  const nextDay = new Date(start.getTime() + 36 * 60 * 60 * 1000)
  const end = workshopDayStart(toWorkshopDay(nextDay))
  if (!end) throw new Error("Could not resolve the workshop day")

  return { start, end }
}

export function addWorkshopDays(day: string, days: number) {
  const start = workshopDayStart(day)
  if (!start) throw new Error("Invalid day")
  // Noon avoids landing on a day boundary when stepping across offsets.
  return toWorkshopDay(new Date(start.getTime() + days * 86_400_000 + 12 * 3_600_000))
}

export function formatWorkshopDate(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: WORKSHOP_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value)
}

export function formatWorkshopTime(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: WORKSHOP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value)
}
