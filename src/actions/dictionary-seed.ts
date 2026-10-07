"use server"

import fs from "node:fs"
import path from "node:path"

import Papa from "papaparse"
import { sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/actions/ingestion"
import { db } from "@/db"
import { masterTaxonomyDictionaryTable, mechanicalSparesTable } from "@/db/schema"
import { isPopulatedCsvRow, toTrimmedString } from "@/lib/spreadsheet"
import { sanitizeTaxonomyTiers } from "@/lib/taxonomy"

// `Final_Master_Dictionary.csv` is a server-side file dropped at the project
// root (next to package.json) rather than something staff upload — see
// `DictionarySeedButton` in src/components/dictionary-seed-button.tsx, which
// just triggers this action with no file picker.
const DICTIONARY_CSV_PATH = path.join(process.cwd(), "Final_Master_Dictionary.csv")

// Upserted in chunks of this size, matching `INSERT_CHUNK_SIZE` in
// src/actions/ingestion.ts: large enough to make a dent in a big file, small
// enough to stay well under Postgres's 65535 bound-parameter limit and avoid
// holding the whole CSV in memory at once.
const BATCH_SIZE = 500

export type SkippedDictionaryRow = { rowNumber: number; error: string }

export type SeedDictionaryResult = {
  // Every non-blank data row Papa Parse handed back, valid or not.
  totalParsed: number
  // Rows actually written via the upsert (inserted + updated).
  totalUpserted: number
  // Rows dropped for missing a Part Number, with the CSV row number.
  totalSkipped: number
  skipped: SkippedDictionaryRow[]
}

type DictionaryRow = {
  partNumber: string
  materialName: string | null
  standardizedMaterialName: string | null
  tier1: string | null
  tier2: string | null
  tier3: string | null
  brandName: string | null
  assetClass: string | null
}

function toOptionalTrimmedString(value: unknown) {
  const trimmed = toTrimmedString(value)
  return trimmed === "" ? null : trimmed
}

// `Final_Master_Dictionary.csv`'s header row (exact casing/spacing, after
// `transformHeader` below only trims whitespace/BOM — it does not lowercase
// or otherwise normalize). This is an explicit, exact-string map from CSV
// header to `masterTaxonomyDictionaryTable` column rather than the
// fuzzy/normalized `indexRowByHeader` lookup `ingestion.ts` uses for the
// ERP exports: those reports vary their header casing/spacing release to
// release, but this dictionary file's shape is controlled by us, so an
// exact map is both sufficient and — unlike a normalized "tier 1"/"tier1"
// lookup, which silently misses this file's actual "Tier_1" header and
// leaves every taxonomy column NULL — correct.
const DICTIONARY_CSV_HEADERS = {
  partNumber: "Part Number",
  materialName: "Material Name",
  standardizedMaterialName: "Standardized Material Name",
  tier1: "Tier_1",
  tier2: "Tier_2",
  tier3: "Tier_3",
  brandName: "Brand Name",
  assetClass: "Asset Class",
} as const

// Maps one CSV row — keyed by the exact headers in
// `DICTIONARY_CSV_HEADERS` — onto `masterTaxonomyDictionaryTable`'s columns.
// Only Part Number is required — every other column is nullable in the
// schema, so a dictionary row missing a tier or brand is still worth
// keeping rather than rejecting outright.
function mapDictionaryRow(
  row: unknown
): { data: DictionaryRow; error: null } | { data: null; error: string } {
  const cells = (row && typeof row === "object" ? row : {}) as Record<
    string,
    unknown
  >

  const rawPartNumber = toTrimmedString(cells[DICTIONARY_CSV_HEADERS.partNumber])

  if (!rawPartNumber) {
    return { data: null, error: "Part Number is required" }
  }

  // The primary match key: trimmed and upper-cased so the same physical
  // part always resolves to the same row regardless of how the ERP or this
  // export happened to case it.
  const partNumber = rawPartNumber.trim().toUpperCase()

  const tiers = sanitizeTaxonomyTiers({
    tier1: toOptionalTrimmedString(cells[DICTIONARY_CSV_HEADERS.tier1]),
    tier2: toOptionalTrimmedString(cells[DICTIONARY_CSV_HEADERS.tier2]),
    tier3: toOptionalTrimmedString(cells[DICTIONARY_CSV_HEADERS.tier3]),
  })

  return {
    data: {
      partNumber,
      materialName: toOptionalTrimmedString(cells[DICTIONARY_CSV_HEADERS.materialName]),
      standardizedMaterialName: toOptionalTrimmedString(
        cells[DICTIONARY_CSV_HEADERS.standardizedMaterialName]
      ),
      tier1: tiers.tier1 || null,
      tier2: tiers.tier2 || null,
      tier3: tiers.tier3 || null,
      brandName: toOptionalTrimmedString(cells[DICTIONARY_CSV_HEADERS.brandName]),
      assetClass: toOptionalTrimmedString(cells[DICTIONARY_CSV_HEADERS.assetClass]),
    },
    error: null,
  }
}

// Upserts one batch on the `part_number` unique index — a Part Number
// already on file gets every classification column (and `updatedAt`)
// overwritten; a new one is inserted. Returns how many rows were affected.
async function upsertDictionaryBatch(rows: DictionaryRow[]) {
  if (rows.length === 0) return 0

  // A single INSERT ... ON CONFLICT DO UPDATE cannot touch the same row
  // twice, so if the dictionary file lists the same Part Number more than
  // once inside this batch, keep only the last occurrence — mirroring the
  // same-batch dedupe `ingestMonthlyPairings` does in src/actions/ingestion.ts.
  const byPartNumber = new Map<string, DictionaryRow>()
  for (const row of rows) byPartNumber.set(row.partNumber, row)
  const deduped = [...byPartNumber.values()]

  const upserted = await db
    .insert(masterTaxonomyDictionaryTable)
    .values(deduped)
    .onConflictDoUpdate({
      target: masterTaxonomyDictionaryTable.partNumber,
      set: {
        materialName: sql`excluded.material_name`,
        standardizedMaterialName: sql`excluded.standardized_material_name`,
        tier1: sql`excluded.tier_1`,
        tier2: sql`excluded.tier_2`,
        tier3: sql`excluded.tier_3`,
        brandName: sql`excluded.brand_name`,
        assetClass: sql`excluded.asset_class`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: masterTaxonomyDictionaryTable.id })

  return upserted.length
}

// Streams `Final_Master_Dictionary.csv` off disk and upserts it into
// `masterTaxonomyDictionaryTable` in batches of `BATCH_SIZE`, so the whole
// file never has to sit in memory at once. Triggered with no arguments by
// `DictionarySeedButton` (src/components/dictionary-seed-button.tsx) on the
// Data Ingestion page's Master Dictionary tab — admin-only, like every other
// bulk importer in src/actions/ingestion.ts.
export async function seedMasterTaxonomyDictionary(): Promise<SeedDictionaryResult> {
  await requireAdmin()

  if (!fs.existsSync(DICTIONARY_CSV_PATH)) {
    throw new Error(
      `Could not find ${path.basename(DICTIONARY_CSV_PATH)} at the project root (${DICTIONARY_CSV_PATH}). Add the file there and try again.`
    )
  }

  let totalParsed = 0
  let totalUpserted = 0
  const skipped: SkippedDictionaryRow[] = []
  let buffer: DictionaryRow[] = []
  // Chains every batch flush so they run one at a time (in file order)
  // even though `step` fires synchronously faster than each upsert can
  // complete — `parser.pause()`/`resume()` below is what actually throttles
  // the stream; this just sequences the resulting upserts.
  let pendingFlush: Promise<void> = Promise.resolve()

  function flush(rows: DictionaryRow[]) {
    return upsertDictionaryBatch(rows).then((count) => {
      totalUpserted += count
    })
  }

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(DICTIONARY_CSV_PATH, "utf8")

    Papa.parse(stream, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      step: (results, parser) => {
        const row = results.data
        if (!isPopulatedCsvRow(row)) return

        totalParsed += 1
        // Row 1 of the file is the header, so the first data row is row 2.
        const rowNumber = totalParsed + 1

        const { data, error } = mapDictionaryRow(row)

        if (error || !data) {
          skipped.push({ rowNumber, error: error ?? "Row could not be parsed" })
          return
        }

        buffer.push(data)

        if (buffer.length >= BATCH_SIZE) {
          // Pausing the stream (rather than letting `step` fire for the
          // entire file up front) is what keeps memory bounded — the next
          // chunk of the file is only read once this batch's upsert
          // finishes and `resume()` is called.
          parser.pause()
          const toFlush = buffer
          buffer = []
          pendingFlush = pendingFlush
            .then(() => flush(toFlush))
            .then(() => parser.resume())
            .catch((flushError) => {
              parser.abort()
              reject(flushError)
            })
        }
      },
      complete: () => {
        pendingFlush
          .then(() => flush(buffer))
          .then(resolve)
          .catch(reject)
      },
      error: (parseError) => reject(parseError),
    })
  })

  skipped.sort((a, b) => a.rowNumber - b.rowNumber)

  console.log(
    `[seedMasterTaxonomyDictionary] parsed ${totalParsed} row(s), upserted ${totalUpserted}, skipped ${skipped.length} malformed row(s).`
  )

  return {
    totalParsed,
    totalUpserted,
    totalSkipped: skipped.length,
    skipped,
  }
}

export type BackfillTaxonomyResult = {
  // Rows in `mechanicalSparesTable` whose Part Number matched a dictionary
  // entry and were rewritten.
  updatedCount: number
}

// Retroactively re-classifies every historical `mechanicalSparesTable` row
// against the now-seeded `masterTaxonomyDictionaryTable`, so spares fitted
// before the dictionary existed get the same canonical Tier 1/2/3 and Asset
// Class as newly-seeded parts. Triggered by the "Retroactive Taxonomy
// Backfill" button next to "Seed Master Dictionary" in
// src/components/dictionary-seed-button.tsx — run that seed first, or this
// has nothing to match against.
//
// This is a single `UPDATE ... FROM ... WHERE ...` statement rather than a
// row-by-row loop: at ~15k spares rows it's one index-backed join on
// Postgres's side (`masterTaxonomyDictionaryTable.partNumber` carries the
// unique index from src/db/schema.ts), so it runs in a fraction of a second
// instead of paying a network round trip per row.
export async function backfillMechanicalSparesTaxonomy(): Promise<BackfillTaxonomyResult> {
  await requireAdmin()

  const updated = await db
    .update(mechanicalSparesTable)
    .set({
      // `mechanicalSparesTable.tier1/2/3` are `NOT NULL` (see
      // src/db/schema.ts), but a dictionary row can leave a tier blank, so
      // a plain overwrite would risk failing the whole statement on a
      // NOT NULL violation. COALESCE keeps the spare's existing value in
      // that case rather than aborting the backfill for every other row.
      tier1: sql`coalesce(${masterTaxonomyDictionaryTable.tier1}, ${mechanicalSparesTable.tier1})`,
      tier2: sql`coalesce(${masterTaxonomyDictionaryTable.tier2}, ${mechanicalSparesTable.tier2})`,
      tier3: sql`coalesce(${masterTaxonomyDictionaryTable.tier3}, ${mechanicalSparesTable.tier3})`,
      // Nullable on `mechanicalSparesTable` (there's no prior value to
      // protect), so this is a straight overwrite from the dictionary.
      assetClass: sql`${masterTaxonomyDictionaryTable.assetClass}`,
    })
    .from(masterTaxonomyDictionaryTable)
    .where(
      // Robust match: the dictionary's `partNumber` is already normalized
      // (trim + upper-case) at seed time by `seedMasterTaxonomyDictionary`
      // above, but historical spares were imported by `ingestSpares`
      // (src/actions/ingestion.ts) with only whitespace trimmed, not
      // case-folded — so the comparison normalizes this side to match.
      sql`upper(trim(${mechanicalSparesTable.partNumber})) = ${masterTaxonomyDictionaryTable.partNumber}`
    )
    .returning({ id: mechanicalSparesTable.id })

  revalidatePath("/spares-history")
  revalidatePath("/data-ingestion")

  console.log(
    `[backfillMechanicalSparesTaxonomy] updated ${updated.length} mechanical spares row(s) from the master taxonomy dictionary.`
  )

  return { updatedCount: updated.length }
}
