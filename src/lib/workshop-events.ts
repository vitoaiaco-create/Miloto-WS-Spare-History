// Shared (client + server safe) constants and helpers for the Workshop
// Events module. Server Actions live in src/actions/workshop-events.ts.

export const WORKSHOP_EVENT_CATEGORIES = [
  "Wheel Alignment",
  "Air System Check",
  "Injector Trim Codes",
] as const
export type WorkshopEventCategory = (typeof WORKSHOP_EVENT_CATEGORIES)[number]

export const AIR_SYSTEM_TEST_OK = "PREVENTATIVE MAINT - AIR SYSTEM TEST OK"
export const AIR_SYSTEM_TEST_FAILED =
  "PREVENTATIVE MAINT - AIR SYSTEM TEST FAILED"
// Legacy outcome of alignments logged before out-of-square measurements were
// captured (and of the historical migration). New alignments never use it.
export const ALIGNMENT_COMPLETED = "COMPLETED"

// The only outcomes each category may record. Enforced by Zod in the Server
// Actions and used to drive the technician form's Outcome select. Wheel
// Alignment is deliberately not listed as selectable: its outcome is derived
// from the axle measurements (see `buildWheelAlignmentOutcome`).
export const WORKSHOP_EVENT_OUTCOMES: Record<
  WorkshopEventCategory,
  readonly string[]
> = {
  "Wheel Alignment": [ALIGNMENT_COMPLETED],
  "Air System Check": [AIR_SYSTEM_TEST_OK, AIR_SYSTEM_TEST_FAILED],
  // Derived from the cylinder codes (see `buildInjectorTrimOutcome`).
  "Injector Trim Codes": [],
}

// ---------------------------------------------------------------------------
// Injector trim codes (Trucks / MTL only, 6 cylinders)
// ---------------------------------------------------------------------------

export const INJECTOR_CYLINDER_COUNT = 6
export const INJECTOR_CODE_MAX_LENGTH = 20
// Letters and digits only; an empty value means "not recorded".
export const INJECTOR_CODE_PATTERN = /^[A-Za-z0-9]*$/

export type InjectorTrimCodes = {
  cyl1?: string | null
  cyl2?: string | null
  cyl3?: string | null
  cyl4?: string | null
  cyl5?: string | null
  cyl6?: string | null
}

// Injector trim codes only apply to prime movers (fleet numbers starting MTL).
export function isInjectorTrimAsset(assetName: string | null | undefined) {
  return (assetName ?? "").trim().toUpperCase().startsWith("MTL")
}

// e.g. "INJECTOR TRIM CODES (OK) - Cyl 1: A1B2 - Cyl 2: - - Cyl 3: ...".
// Always "(OK)" so the Event Compliance dashboard counts it as compliant.
export function buildInjectorTrimOutcome(codes: InjectorTrimCodes) {
  const { cyl1, cyl2, cyl3, cyl4, cyl5, cyl6 } = codes
  return (
    `INJECTOR TRIM CODES (OK) - Cyl 1: ${cyl1 || "-"} - Cyl 2: ${cyl2 || "-"}` +
    ` - Cyl 3: ${cyl3 || "-"} - Cyl 4: ${cyl4 || "-"} - Cyl 5: ${cyl5 || "-"}` +
    ` - Cyl 6: ${cyl6 || "-"}`
  )
}

// ---------------------------------------------------------------------------
// Wheel alignment out-of-square measurements (mm/m)
// ---------------------------------------------------------------------------

// An axle at or beyond +/- this value is out of spec and fails the alignment.
export const ALIGNMENT_OUT_OF_SQUARE_LIMIT = 3

export type AlignmentAxleNumber = 1 | 2 | 3

export type AlignmentAxleValues = {
  axle1?: number | null
  axle2?: number | null
  axle3?: number | null
}

export function isAlignmentAxleOutOfSpec(value: number) {
  return (
    value >= ALIGNMENT_OUT_OF_SQUARE_LIMIT ||
    value <= -ALIGNMENT_OUT_OF_SQUARE_LIMIT
  )
}

// Which axles a technician measures for a unit, from its fleet number:
// MTL = prime mover (Axle 2 and 3), other MT = trailer (Axle 1, 2 and 3).
// Anything else offers all three rather than blocking the entry.
export function getAlignmentAxles(assetName: string | null | undefined) {
  const name = (assetName ?? "").trim().toUpperCase()
  const axles: AlignmentAxleNumber[] = name.startsWith("MTL") ? [2, 3] : [1, 2, 3]
  return axles
}

// Builds the stored outcome for a wheel alignment, e.g.
// "WHEEL ALIGNMENT (FAILED) - Out of Square - Axle 2: 4 mm/m". Any axle at or
// beyond +/-3 fails the alignment. The "FAILED" keyword is what the Compliance
// Dashboard and the Director's Summary Matrix key off.
export function buildWheelAlignmentOutcome(axles: AlignmentAxleValues) {
  const { axle1, axle2, axle3 } = axles
  const values = [axle1, axle2, axle3]
  const status = values.some(
    (value) => typeof value === "number" && isAlignmentAxleOutOfSpec(value)
  )
    ? "FAILED"
    : "OK"

  // `!= null` (not truthiness) so a perfect 0 mm/m reading is still recorded.
  const outcome =
    `WHEEL ALIGNMENT (${status}) - Out of Square` +
    (axle1 != null ? ` - Axle 1: ${axle1} mm/m` : "") +
    (axle2 != null ? ` - Axle 2: ${axle2} mm/m` : "") +
    (axle3 != null ? ` - Axle 3: ${axle3} mm/m` : "")

  return { status, outcome } as const
}

export type ParsedWheelAlignmentOutcome = {
  // null for legacy "COMPLETED" alignments that carry no pass/fail result.
  status: "OK" | "FAILED" | null
  axle1: number | null
  axle2: number | null
  axle3: number | null
}

const ALIGNMENT_AXLE_PATTERN = /Axle ([123]): (-?[\d.]+(?:e[-+]?\d+)?) mm\/m/gi

export function parseWheelAlignmentOutcome(
  eventOutcome: string
): ParsedWheelAlignmentOutcome {
  const upper = eventOutcome.toUpperCase()
  const parsed: ParsedWheelAlignmentOutcome = {
    status: upper.includes("WHEEL ALIGNMENT (FAILED)")
      ? "FAILED"
      : upper.includes("WHEEL ALIGNMENT (OK)")
        ? "OK"
        : null,
    axle1: null,
    axle2: null,
    axle3: null,
  }

  for (const match of eventOutcome.matchAll(ALIGNMENT_AXLE_PATTERN)) {
    const value = Number(match[2])
    if (!Number.isFinite(value)) continue
    if (match[1] === "1") parsed.axle1 = value
    else if (match[1] === "2") parsed.axle2 = value
    else parsed.axle3 = value
  }

  return parsed
}

// The matrix-friendly shape of a technician event (same event types the
// Director's Summary Matrix uses for manual events), or null for an
// unrecognised category/outcome.
export type WorkshopEventMatrixInput = {
  eventType: "WHEEL_ALIGNMENT" | "AIR_SYSTEM_OK" | "AIR_SYSTEM_FAIL"
  alignmentStatus?: "OK" | "FAILED" | null
  outOfSquareAxle1?: number | null
  outOfSquareAxle2?: number | null
  outOfSquareAxle3?: number | null
}

export function toWorkshopEventMatrixInput(
  eventCategory: string,
  eventOutcome: string
): WorkshopEventMatrixInput | null {
  if (eventCategory === "Wheel Alignment") {
    const parsed = parseWheelAlignmentOutcome(eventOutcome)
    return {
      eventType: "WHEEL_ALIGNMENT",
      alignmentStatus: parsed.status,
      outOfSquareAxle1: parsed.axle1,
      outOfSquareAxle2: parsed.axle2,
      outOfSquareAxle3: parsed.axle3,
    }
  }

  if (eventCategory === "Air System Check") {
    const outcome = eventOutcome.toUpperCase()
    // FAILED first so a failed test can never be read as passing.
    if (outcome.includes("FAILED")) return { eventType: "AIR_SYSTEM_FAIL" }
    if (outcome.includes("AIR SYSTEM TEST OK")) {
      return { eventType: "AIR_SYSTEM_OK" }
    }
  }

  return null
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
  // When the check actually happened (may be backdated).
  eventDate: Date
  // When the entry was made in the system.
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
  assetType: string
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
