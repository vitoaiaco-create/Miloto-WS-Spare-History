import { z } from "zod"

// Zod schemas that validate bulk spreadsheet imports (CSV/XLSX rows parsed
// by `src/components/data-uploader.tsx`) before they're written to the
// tables defined in `src/db/schema.ts`. These are the single source of
// truth for "is this row shaped correctly" — Server Actions in
// `src/actions/ingestion.ts` call `.parse()` on the raw parsed rows and
// never trust the caller's TypeScript types alone.

// Workshop staff identify an asset by its fleet number (e.g. "MTL-01",
// "MT-05"), which is stored as `assetsTable.assetName`. Spreadsheets don't
// know the internal numeric `assetsTable.id`, so every imported row
// references the asset by this string — the ingestion Server Action is
// responsible for resolving it to an `assetId` before inserting.
const fleetNumberSchema = z
  .string()
  .trim()
  .min(1, "Fleet number is required")
  .regex(
    /^(MTL|MT)-?\d+$/i,
    "Fleet number must start with MTL or MT (e.g. MTL-01, MT-05)"
  )

// A single row of the "Spares Outward List" spreadsheet, mapped onto the
// columns of `mechanicalSparesTable`.
const sparesRowSchema = z
  .object({
    fleetNumber: fleetNumberSchema,
    fitmentDate: z.coerce.date({ error: "Fitment date is required" }),
    partNumber: z.string().trim().min(1, "Part number is required"),
    materialName: z.string().trim().min(1, "Material name is required"),
    jobCardNo: z.string().trim().min(1, "Job card number is required"),
    quantity: z.coerce.number().positive("Quantity must be greater than 0"),
    costKwacha: z.coerce.number().nonnegative("Cost cannot be negative"),
    tier1: z.string().trim().min(1, "Tier 1 category is required"),
    tier2: z.string().trim().min(1, "Tier 2 category is required"),
    tier3: z.string().trim().min(1, "Tier 3 category is required"),
    // Not present in every source file — installation point is optional.
    installationPoint: z.string().trim().min(1).optional().nullable(),
  })
  .strict()

export const bulkSparesSchema = z
  .array(sparesRowSchema)
  .min(1, "The file did not contain any rows to import")

export type SparesRow = z.infer<typeof sparesRowSchema>
export type BulkSparesInput = z.infer<typeof bulkSparesSchema>

// A single row of the "Daily Mileage Log" spreadsheet, mapped onto the
// columns of `mileageLogsTable`.
const mileageRowSchema = z
  .object({
    fleetNumber: fleetNumberSchema,
    date: z.coerce.date({ error: "Date is required" }),
    odometer: z.coerce
      .number()
      .nonnegative("Odometer reading cannot be negative"),
  })
  .strict()

export const bulkMileageSchema = z
  .array(mileageRowSchema)
  .min(1, "The file did not contain any rows to import")

export type MileageRow = z.infer<typeof mileageRowSchema>
export type BulkMileageInput = z.infer<typeof bulkMileageSchema>
