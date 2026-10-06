"use server"

import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireAdmin } from "@/actions/ingestion"
import { db } from "@/db"
import {
  masterTaxonomyDictionaryTable,
  mechanicalSparesTable,
  unmappedSparesStagingTable,
} from "@/db/schema"

const MAX_TIER = 100

// Matches `mapDictionaryRow`'s own key in src/actions/dictionary-seed.ts, so
// the taxonomy learned here resolves to the same dictionary row a future
// CSV upload (or a re-run of the dictionary CSV itself) would hit.
function normalizeDictionaryPartNumber(partNumber: string) {
  return partNumber.trim().toUpperCase()
}

const commitUnmappedSpareSchema = z.object({
  stagingId: z.number().int().positive(),
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

export type CommitUnmappedSpareInput = z.infer<typeof commitUnmappedSpareSchema>

export type CommitUnmappedSpareResult = {
  stagingId: number
  partNumber: string
}

// Promotes one Triage Inbox row (src/components/triage-inbox.tsx) once a
// staff member has picked its Tier 1/2/3 and Asset Class:
//
//   a) the chosen taxonomy is upserted into `masterTaxonomyDictionaryTable`
//      so the *next* CSV upload with this Part Number matches automatically
//      in `ingestSpares` (src/actions/ingestion.ts),
//   b) the spare itself is inserted into `mechanicalSparesTable` exactly as
//      if it had matched the dictionary the first time, and
//   c) the staging row is deleted.
//
// All three statements go out as one `db.batch()` call rather than
// individual `await`s. The neon-http driver (src/db/index.ts) has no
// `db.transaction()` — see its session.js, which throws "No transactions
// support in neon-http driver" — but `batch()` sends every query to Neon in
// a single request that Neon itself runs as one real Postgres transaction,
// so a failure on any one of the three leaves none of them applied.
export async function commitUnmappedSpare(
  input: CommitUnmappedSpareInput
): Promise<CommitUnmappedSpareResult> {
  await requireAdmin()

  const data = commitUnmappedSpareSchema.parse(input)

  const [staging] = await db
    .select()
    .from(unmappedSparesStagingTable)
    .where(
      and(
        eq(unmappedSparesStagingTable.id, data.stagingId),
        eq(unmappedSparesStagingTable.status, "pending")
      )
    )
    .limit(1)

  if (!staging) {
    throw new Error(
      "This row is no longer pending triage. Refresh the Triage Inbox."
    )
  }

  const partNumber = normalizeDictionaryPartNumber(staging.partNumber)
  const now = new Date()

  const [, , deleted] = await db.batch([
    db
      .insert(masterTaxonomyDictionaryTable)
      .values({
        partNumber,
        materialName: staging.materialName,
        tier1: data.tier1,
        tier2: data.tier2,
        tier3: data.tier3,
        assetClass: data.assetClass,
        updatedAt: now,
      })
      // The seed script's own match key (`master_taxonomy_dictionary_part_number_idx`
      // in src/db/schema.ts) — a Part Number already on file gets its
      // taxonomy overwritten with the staff member's choice rather than
      // duplicated.
      .onConflictDoUpdate({
        target: masterTaxonomyDictionaryTable.partNumber,
        set: {
          tier1: data.tier1,
          tier2: data.tier2,
          tier3: data.tier3,
          assetClass: data.assetClass,
          updatedAt: now,
        },
      }),
    db
      .insert(mechanicalSparesTable)
      .values({
        assetId: staging.assetId,
        fitmentDate: staging.fitmentDate,
        partNumber: staging.partNumber,
        materialName: staging.materialName,
        jobCardNo: staging.jobCardNo,
        quantity: staging.quantity,
        costKwacha: staging.costKwacha,
        priceUsd: staging.priceUsd,
        costUsd: staging.costUsd,
        installationPoint: staging.installationPoint,
        tier1: data.tier1,
        tier2: data.tier2,
        tier3: data.tier3,
        assetClass: data.assetClass,
      })
      // Same unique index `ingestSpares` relies on — a defensive no-op if
      // this exact line somehow already made it into spares history.
      .onConflictDoNothing({
        target: [
          mechanicalSparesTable.jobCardNo,
          mechanicalSparesTable.partNumber,
          mechanicalSparesTable.fitmentDate,
        ],
      }),
    db
      .delete(unmappedSparesStagingTable)
      .where(eq(unmappedSparesStagingTable.id, data.stagingId))
      .returning({ id: unmappedSparesStagingTable.id }),
  ])

  if (!deleted[0]) {
    throw new Error(
      "Failed to commit this row — it may have already been processed."
    )
  }

  revalidatePath("/data-ingestion")
  revalidatePath("/spares-history")

  return { stagingId: data.stagingId, partNumber: staging.partNumber }
}
