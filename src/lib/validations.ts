import { z } from "zod"

import {
  indexRowByHeader,
  inferAssetType,
  normalizeSubEquipment,
  parseSpreadsheetDate,
  toCanonicalFleetNumber,
  toNumber,
  toOptionalNumber,
  toTrimmedString,
} from "@/lib/spreadsheet"

// Zod schemas that validate bulk spreadsheet imports (CSV/XLSX rows parsed
// by `src/components/data-uploader.tsx`) before they're written to the
// tables defined in `src/db/schema.ts`. These are the single source of truth
// for "is this row shaped correctly" — the Server Actions in
// `src/actions/ingestion.ts` call `.safeParse()` on the raw parsed rows and
// never trust the caller's TypeScript types alone.
//
// Each schema is a `z.preprocess` in two stages:
//
//  1. a mapping step that reads the spreadsheet's own column headers (e.g.
//     "Identity No", "Outward Date") and normalizes each cell via
//     `src/lib/spreadsheet.ts`, and
//  2. a plain object schema that asserts the normalized row.
//
// Keeping the header names here rather than in the client uploader means the
// file's real shape is what gets validated on the server. The mapping only
// picks out the columns these tables need, so the ~14 extra columns the
// outward report carries ("SNo", "Brand Name", "Ex. Rate", …) are ignored
// rather than rejected — the reason these schemas are not `.strict()`.

// Max lengths mirror the `varchar` widths in `src/db/schema.ts` so an
// oversized cell fails here with a row number instead of surfacing as a
// Postgres error part-way through an insert.
const MAX_ASSET_NAME = 255
const MAX_PART_NUMBER = 100
const MAX_MATERIAL_NAME = 255
const MAX_JOB_CARD_NO = 50
const MAX_TIER = 100
const MAX_INSTALLATION_POINT = 255

// Workshop staff identify an asset by its fleet number, stored as
// `assetsTable.assetName`. Spreadsheets don't know the internal numeric
// `assetsTable.id`, so every imported row references the asset by this
// string and `src/actions/ingestion.ts` resolves it to an `assetId`.
//
// There is deliberately no format constraint beyond "non-empty": alongside
// prime movers and trailers the fleet includes cranes ("CM05"), a tow truck
// ("TT-TOW TRUCK") and one-off units ("AB01(610)"). The label names the
// column the value came from, which differs per file.
const fleetNumberSchema = (column: string) =>
  z
    .string()
    .min(1, `${column} is required`)
    .max(MAX_ASSET_NAME, `${column} must be ${MAX_ASSET_NAME} characters or fewer`)

// A single row of the "Job Cards OutWard Report", mapped onto the columns of
// `mechanicalSparesTable`. Rows are validated one at a time by
// `src/actions/ingestion.ts` so that one malformed row (the current report
// has a line with no "Amount (K)" cell) can be reported and skipped instead
// of rejecting the whole file.
export const sparesRowSchema = z.preprocess((row) => {
  const cells = indexRowByHeader(row)

  return {
    fleetNumber: toCanonicalFleetNumber(toTrimmedString(cells.get("identity no"))),
    fitmentDate: parseSpreadsheetDate(cells.get("outward date")),
    partNumber: toTrimmedString(cells.get("part number")),
    materialName: toTrimmedString(cells.get("material name")),
    jobCardNo: toTrimmedString(cells.get("job card no")),
    quantity: toNumber(cells.get("quantity")),
    // "Amount (K)" is the local-currency figure, kept for future reporting.
    // The Spares History table shows the dollar columns below, which the
    // report carries in their own right rather than as a conversion the app
    // has to apply through the day's "Ex. Rate".
    costKwacha: toNumber(cells.get("amount (k)")),
    priceUsd: toOptionalNumber(cells.get("price ($)")),
    costUsd: toOptionalNumber(cells.get("amount ($)")),
    // "Sub Equipment" is the value the table renders and the filter bar
    // searches, so it is pinned to `tier1`; "Category" and "Sub-Category"
    // are kept verbatim in `tier2`/`tier3` for future reporting. Only
    // `tier1` is case-normalized — `tier2`/`tier3` hold model codes such as
    // "140K,C9, 950H, D6R" that title casing would mangle.
    tier1: normalizeSubEquipment(toTrimmedString(cells.get("sub equipment"))),
    tier2: toTrimmedString(cells.get("category")),
    tier3: toTrimmedString(cells.get("sub-category")),
    // Not a column in the outward report; reserved for future
    // part-lifespan calculations keyed to a fitment location.
    installationPoint: toTrimmedString(cells.get("installation point")) || null,
  }
}, z.object({
  fleetNumber: fleetNumberSchema("Identity No"),
  fitmentDate: z.date({ error: "Outward Date must be a valid date (DD-MM-YYYY)" }),
  partNumber: z
    .string()
    .min(1, "Part Number is required")
    .max(MAX_PART_NUMBER, `Part Number must be ${MAX_PART_NUMBER} characters or fewer`),
  materialName: z
    .string()
    .min(1, "Material Name is required")
    .max(MAX_MATERIAL_NAME, `Material Name must be ${MAX_MATERIAL_NAME} characters or fewer`),
  jobCardNo: z
    .string()
    .min(1, "Job Card No is required")
    .max(MAX_JOB_CARD_NO, `Job Card No must be ${MAX_JOB_CARD_NO} characters or fewer`),
  quantity: z
    .number("Quantity must be a number")
    .positive("Quantity must be greater than 0"),
  costKwacha: z
    .number("Amount (K) must be a number")
    .nonnegative("Amount (K) cannot be negative"),
  priceUsd: z
    .number("Price ($) must be a number")
    .nonnegative("Price ($) cannot be negative")
    .nullable(),
  costUsd: z
    .number("Amount ($) must be a number")
    .nonnegative("Amount ($) cannot be negative")
    .nullable(),
  tier1: z
    .string()
    .min(1, "Sub Equipment is required")
    .max(MAX_TIER, `Sub Equipment must be ${MAX_TIER} characters or fewer`),
  tier2: z
    .string()
    .min(1, "Category is required")
    .max(MAX_TIER, `Category must be ${MAX_TIER} characters or fewer`),
  tier3: z
    .string()
    .min(1, "Sub-Category is required")
    .max(MAX_TIER, `Sub-Category must be ${MAX_TIER} characters or fewer`),
  installationPoint: z
    .string()
    .max(
      MAX_INSTALLATION_POINT,
      `Installation Point must be ${MAX_INSTALLATION_POINT} characters or fewer`
    )
    .nullable(),
}))

export type SparesRow = z.infer<typeof sparesRowSchema>

// A single row of the "Daily Mileage Log", mapped onto the columns of
// `mileageLogsTable`. The source file's own `asset_id` column is ignored:
// `assetsTable.id` is `generatedAlwaysAsIdentity`, so assets are matched by
// name instead of by a number that means nothing outside that export.
export const mileageRowSchema = z.preprocess((row) => {
  const cells = indexRowByHeader(row)

  return {
    fleetNumber: toCanonicalFleetNumber(toTrimmedString(cells.get("asset_name"))),
    date: parseSpreadsheetDate(cells.get("date")),
    odometer: toNumber(cells.get("odometer")),
  }
}, z.object({
  fleetNumber: fleetNumberSchema("asset_name"),
  date: z.date({ error: "Date must be a valid date (DD-MM-YYYY or YYYY-MM-DD)" }),
  odometer: z
    .number("Odometer must be a number")
    .nonnegative("Odometer reading cannot be negative"),
}))

export type MileageRow = z.infer<typeof mileageRowSchema>

// A single row of the fleet asset list, mapped onto the columns of
// `assetsTable`. As above, the export's `id` column is ignored.
export const assetRowSchema = z.preprocess((row) => {
  const cells = indexRowByHeader(row)
  const assetName = toCanonicalFleetNumber(toTrimmedString(cells.get("asset_name")))

  return {
    assetName,
    // Falls back to the type implied by the code itself so a list that only
    // carries names still imports.
    assetType:
      toTrimmedString(cells.get("asset_type")) || inferAssetType(assetName),
  }
}, z.object({
  assetName: fleetNumberSchema("asset_name"),
  assetType: z
    .string()
    .min(1, "Asset type is required")
    .max(100, "Asset type must be 100 characters or fewer"),
}))

export type AssetRow = z.infer<typeof assetRowSchema>
