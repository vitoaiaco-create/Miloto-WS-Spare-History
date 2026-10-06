"use server"

import { sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireAdmin } from "@/actions/ingestion"
import { db } from "@/db"
import { masterTaxonomyDictionaryTable, mechanicalSparesTable } from "@/db/schema"

const MAX_TIER = 100

// Matches `mapDictionaryRow`'s own key in src/actions/dictionary-seed.ts, so
// the taxonomy learned here resolves to the same dictionary row a future
// CSV upload (or a re-run of the dictionary CSV itself) would hit.
function normalizeDictionaryPartNumber(partNumber: string) {
  return partNumber.trim().toUpperCase()
}

const commitOrphanTaxonomySchema = z.object({
  // The orphan row's exact Part Number as stored on `mechanicalSparesTable`
  // — not yet normalized; normalization happens below, the same way
  // `backfillMechanicalSparesTaxonomy` does it.
  partNumber: z.string().trim().min(1, "Part number is required").max(100),
  materialName: z
    .string()
    .trim()
    .max(255)
    .nullable(),
  tier1: z
    .string()
    .trim()
    .min(1, "Tier 1 is required")
    .max(MAX_TIER, `Tier 1 must be ${MAX_TIER} characters or fewer`),
  tier2: z
    .string()
    .trim()
    .min(1, "Tier 2 is required")
    .max(MAX_TIER, `Tier 2 must be ${MAX_TIER} characters or fewer`),
  tier3: z
    .string()
    .trim()
    .min(1, "Tier 3 is required")
    .max(MAX_TIER, `Tier 3 must be ${MAX_TIER} characters or fewer`),
  assetClass: z
    .string()
    .trim()
    .min(1, "Asset class is required")
    .max(MAX_TIER, `Asset class must be ${MAX_TIER} characters or fewer`),
})

export type CommitOrphanTaxonomyInput = z.infer<typeof commitOrphanTaxonomySchema>

export type CommitOrphanTaxonomyResult = {
  partNumber: string
  sparesUpdated: number
}

// Resolves one row of the Historical Orphans List
// (src/components/orphan-spares-table.tsx) once a staff member has picked
// its Tier 1/2/3 and Asset Class:
//
//   a) that taxonomy is upserted into `masterTaxonomyDictionaryTable`,
//      keyed on the normalized Part Number, so this part resolves
//      automatically on every future CSV upload and dictionary re-seed, and
//   b) every historical `mechanicalSparesTable` row sharing this Part
//      Number — not just the one combination shown in the orphans list —
//      is rewritten with the same tiers and Asset Class, clearing the
//      backfill gap for good.
//
// Both statements go out as one `db.batch()` call rather than individual
// `await`s. The neon-http driver (src/db/index.ts) has no `db.transaction()`
// — see its session.js, which throws "No transactions support in neon-http
// driver" — but `batch()` sends every query to Neon in a single request
// that Neon itself runs as one real Postgres transaction, so a failure on
// either statement leaves neither applied.
export async function commitOrphanTaxonomy(
  input: CommitOrphanTaxonomyInput
): Promise<CommitOrphanTaxonomyResult> {
  await requireAdmin()

  const data = commitOrphanTaxonomySchema.parse(input)
  const dictionaryPartNumber = normalizeDictionaryPartNumber(data.partNumber)
  const now = new Date()

  const [, updatedSpares] = await db.batch([
    db
      .insert(masterTaxonomyDictionaryTable)
      .values({
        partNumber: dictionaryPartNumber,
        materialName: data.materialName,
        tier1: data.tier1,
        tier2: data.tier2,
        tier3: data.tier3,
        assetClass: data.assetClass,
        updatedAt: now,
      })
      // The seed script's own match key
      // (`master_taxonomy_dictionary_part_number_idx` in src/db/schema.ts)
      // — a Part Number already on file (even with a stale/partial
      // classification) gets its taxonomy overwritten with the staff
      // member's choice rather than duplicated.
      .onConflictDoUpdate({
        target: masterTaxonomyDictionaryTable.partNumber,
        set: {
          materialName: data.materialName,
          tier1: data.tier1,
          tier2: data.tier2,
          tier3: data.tier3,
          assetClass: data.assetClass,
          updatedAt: now,
        },
      }),
    db
      .update(mechanicalSparesTable)
      .set({
        tier1: data.tier1,
        tier2: data.tier2,
        tier3: data.tier3,
        assetClass: data.assetClass,
      })
      // Same normalized comparison `backfillMechanicalSparesTaxonomy` uses
      // in src/actions/dictionary-seed.ts: historical spares were imported
      // with only whitespace trimmed, not case-folded, so this side of the
      // match is normalized to line up with `dictionaryPartNumber`.
      .where(
        sql`upper(trim(${mechanicalSparesTable.partNumber})) = ${dictionaryPartNumber}`
      )
      .returning({ id: mechanicalSparesTable.id }),
  ])

  revalidatePath("/data-ingestion")
  revalidatePath("/spares-history")

  console.log(
    `[commitOrphanTaxonomy] taught ${dictionaryPartNumber}, rewrote ${updatedSpares.length} mechanical spares row(s).`
  )

  return { partNumber: data.partNumber, sparesUpdated: updatedSpares.length }
}
