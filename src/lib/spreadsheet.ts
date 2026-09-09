// Helpers that normalize raw cell values from the workshop's exported
// spreadsheets (the "Job Cards OutWard Report", the "Daily Mileage Log" and
// the fleet asset list) into the canonical forms stored by
// `src/db/schema.ts`. The Zod schemas in `src/lib/validations.ts` run every
// imported cell through these before asserting the row is valid.

// Cells arrive as strings, numbers, `undefined` (blank cell or missing
// column) or — when a sheet has been re-saved with real date cells — `Date`
// objects, so anything destined for a text column is coerced here rather
// than assumed to already be a string.
export function toTrimmedString(value: unknown) {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

// `Number()` alone returns NaN for the thousands separators that Excel
// exports leave in numeric columns (e.g. "1,200").
export function toNumber(value: unknown) {
  if (typeof value === "number") return value

  const cleaned = toTrimmedString(value).replace(/[\s,]/g, "")
  return cleaned === "" ? Number.NaN : Number(cleaned)
}

// The outward report's "Price ($)" / "Amount ($)" columns are blank on some
// lines, and those lines are still worth importing, so an empty cell maps to
// `null` instead of NaN. A cell holding something that isn't a number still
// yields NaN and is rejected by the Zod schema. The currency symbol is
// stripped in case the export carries it through.
export function toOptionalNumber(value: unknown) {
  if (typeof value === "number") return value

  const cleaned = toTrimmedString(value).replace(/[\s,$]/g, "")
  return cleaned === "" ? null : Number(cleaned)
}

// Header names pick up stray whitespace and change case between report runs,
// so rows are indexed by a normalized header rather than read by exact key.
export function indexRowByHeader(row: unknown) {
  const cells = new Map<string, unknown>()

  if (row && typeof row === "object") {
    for (const [header, value] of Object.entries(row)) {
      cells.set(header.trim().toLowerCase(), value)
    }
  }

  return cells
}

function padUnitNumber(digits: string) {
  return String(Number(digits)).padStart(2, "0")
}

// Assets are identified inconsistently across the source files: the fleet
// list and mileage log use bare codes ("MTL01"), while the outward report's
// "Identity No" column wraps an alias in brackets ("MILOTO-25(MTL25)",
// "MTL112(MILOTO-112)", "MT124(TRAILER124)"). Both sides have to collapse to
// the same `assetsTable.assetName` or the Running KM lookup in
// `src/lib/spares-history.ts` cannot join a spare to its odometer readings.
//
// Prime movers are matched before trailers deliberately: "MTL25" also starts
// with the trailer prefix "MT", and the two must never merge — trailer MT124
// and prime mover MTL124 are different physical assets.
export function toCanonicalFleetNumber(identityNo: string) {
  const value = identityNo.trim().toUpperCase()

  const primeMover = value.match(/(?:MTL|MILOTO)\s*-?\s*(\d+)/)
  if (primeMover) return `MTL${padUnitNumber(primeMover[1])}`

  const trailer = value.match(/(?:TRAILER|MT)\s*-?\s*(\d+)/)
  if (trailer) return `MT${padUnitNumber(trailer[1])}`

  const crane = value.match(/CM\s*-?\s*(\d+)/)
  if (crane) return `CM${padUnitNumber(crane[1])}`

  // Anything that doesn't follow a numbered convention (e.g. "TT-TOW TRUCK",
  // "AB01(610)") keeps its leading code, minus any bracketed alias.
  return value.replace(/\(.*\)/, "").trim()
}

// The outward report references trailers, cranes and the tow truck, none of
// which appear in the prime-mover fleet list, so `ingestSpares` registers
// them on the fly and needs a type for `assetsTable.assetType`.
export function inferAssetType(fleetNumber: string) {
  if (/^MTL\d+$/.test(fleetNumber)) return "Prime Mover"
  if (/^MT\d+$/.test(fleetNumber)) return "Trailer"
  if (/^CM\d+$/.test(fleetNumber)) return "Crane"
  if (fleetNumber.includes("TOW")) return "Tow Truck"
  return "Other"
}

// The outward report writes sub equipment in upper case ("AIR SYSTEM") while
// the filter dropdown in `src/components/spares-filter-bar.tsx` offers title
// case ("Air System"). Ingestion and the filter query both normalize through
// this so the stored value and the filter value compare equal.
export function normalizeSubEquipment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

// Excel serial dates count days from 1899-12-30.
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

function toUtcDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(Date.UTC(year, month - 1, day))

  // Rejects overflow such as 31-02-2026, which `Date.UTC` would silently
  // roll forward into March.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }

  return date
}

// The outward report writes dates day-first ("02-01-2026" is 2 January), the
// mileage log writes ISO ("2025-01-02"), and a re-saved sheet can hand back
// an Excel serial number or a real `Date`. Day-first strings are parsed
// explicitly because `new Date("02-01-2026")` reads them as 1 February.
// Every date is built in UTC so that the `toISOString().slice(0, 10)` used
// to fill the `date` columns can't roll the day backwards in a
// negative-offset timezone.
export function parseSpreadsheetDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? new Date(EXCEL_EPOCH_UTC + value * MS_PER_DAY)
      : null
  }

  const trimmed = toTrimmedString(value)
  if (!trimmed) return null

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return toUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const dayFirst = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (dayFirst) {
    return toUtcDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]))
  }

  return null
}

// Formats a validated `Date` as the `YYYY-MM-DD` string expected by the
// `date`/`fitmentDate` columns, both declared with the default `date()` mode
// in `src/db/schema.ts` (which stores and returns plain date strings).
export function toIsoDateString(date: Date) {
  return date.toISOString().slice(0, 10)
}
