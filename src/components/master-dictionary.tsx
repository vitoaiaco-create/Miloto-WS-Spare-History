import { isNotNull, isNull, or, sql } from "drizzle-orm"

import {
  MasterDictionaryTable,
  type MasterDictionaryRow,
} from "@/components/master-dictionary-table"
import {
  OrphanSparesTable,
  type OrphanDictionaryOptions,
  type OrphanSpareRow,
} from "@/components/orphan-spares-table"
import { db } from "@/db"
import { masterTaxonomyDictionaryTable, mechanicalSparesTable } from "@/db/schema"

// Every row currently on file in `masterTaxonomyDictionaryTable` — see
// `seedMasterTaxonomyDictionary` in src/actions/dictionary-seed.ts for how
// it got there. Fetched in full (a few thousand rows) and paginated
// client-side by `MasterDictionaryTable`.
async function getMasterDictionaryRows(): Promise<MasterDictionaryRow[]> {
  return db
    .select({
      id: masterTaxonomyDictionaryTable.id,
      partNumber: masterTaxonomyDictionaryTable.partNumber,
      materialName: masterTaxonomyDictionaryTable.materialName,
      tier1: masterTaxonomyDictionaryTable.tier1,
      tier2: masterTaxonomyDictionaryTable.tier2,
      tier3: masterTaxonomyDictionaryTable.tier3,
      assetClass: masterTaxonomyDictionaryTable.assetClass,
    })
    .from(masterTaxonomyDictionaryTable)
    .orderBy(masterTaxonomyDictionaryTable.partNumber)
}

// The historical `mechanicalSparesTable` rows the taxonomy backfill
// (`backfillMechanicalSparesTaxonomy` in src/actions/dictionary-seed.ts)
// couldn't fully resolve, collapsed to their distinct Part Number /
// Material Name combinations. A spare is "orphaned" here if any of:
//
//   - its Asset Class is still NULL (the backfill had nothing to write), or
//   - its Tier 1 doesn't start with a digit — the master dictionary's own
//     convention (e.g. "10 - Engine") — meaning it's carrying a stale,
//     pre-taxonomy tier instead of a dictionary-sourced one, or
//   - its Part Number simply has no row in `masterTaxonomyDictionaryTable`
//     to match against at all.
//
// The LEFT JOIN mirrors the normalized comparison
// `backfillMechanicalSparesTaxonomy` uses (trim + upper-case on the spares
// side, since the dictionary's own Part Number is already normalized at
// seed time) so "no match" here means exactly what it means there.
async function getOrphanSpares(): Promise<OrphanSpareRow[]> {
  return db
    .selectDistinct({
      partNumber: mechanicalSparesTable.partNumber,
      materialName: mechanicalSparesTable.materialName,
    })
    .from(mechanicalSparesTable)
    .leftJoin(
      masterTaxonomyDictionaryTable,
      sql`upper(trim(${mechanicalSparesTable.partNumber})) = ${masterTaxonomyDictionaryTable.partNumber}`
    )
    .where(
      or(
        isNull(mechanicalSparesTable.assetClass),
        sql`${mechanicalSparesTable.tier1} !~ '^[0-9]'`,
        isNull(masterTaxonomyDictionaryTable.id)
      )
    )
    .orderBy(mechanicalSparesTable.partNumber)
}

function sortUniqueValues(rows: { value: string | null }[]) {
  return [
    ...new Set(
      rows
        .map((row) => row.value)
        .filter((value): value is string => value !== null && value !== "")
    ),
  ].sort((a, b) => a.localeCompare(b))
}

// Dropdown choices for the orphan cleanup tool's Tier 1/2/3 and Asset Class
// selectors come from whatever `masterTaxonomyDictionaryTable` already has
// on file — the same vocabulary Triage Inbox draws from
// (src/components/triage-inbox.tsx) — so a staff member's pick here can't
// drift from the dictionary's own classifications.
async function getDictionaryOptions(): Promise<OrphanDictionaryOptions> {
  const [tier1Rows, tier2Rows, tier3Rows, assetClassRows] = await Promise.all([
    db
      .selectDistinct({ value: masterTaxonomyDictionaryTable.tier1 })
      .from(masterTaxonomyDictionaryTable)
      .where(isNotNull(masterTaxonomyDictionaryTable.tier1)),
    db
      .selectDistinct({ value: masterTaxonomyDictionaryTable.tier2 })
      .from(masterTaxonomyDictionaryTable)
      .where(isNotNull(masterTaxonomyDictionaryTable.tier2)),
    db
      .selectDistinct({ value: masterTaxonomyDictionaryTable.tier3 })
      .from(masterTaxonomyDictionaryTable)
      .where(isNotNull(masterTaxonomyDictionaryTable.tier3)),
    db
      .selectDistinct({ value: masterTaxonomyDictionaryTable.assetClass })
      .from(masterTaxonomyDictionaryTable)
      .where(isNotNull(masterTaxonomyDictionaryTable.assetClass)),
  ])

  return {
    tier1: sortUniqueValues(tier1Rows),
    tier2: sortUniqueValues(tier2Rows),
    tier3: sortUniqueValues(tier3Rows),
    assetClass: sortUniqueValues(assetClassRows),
  }
}

// Server Component: reads `masterTaxonomyDictionaryTable` and the orphaned
// `mechanicalSparesTable` combinations directly (per
// data-access-patterns.mdc), then hands both down to the Client Components
// that render the Master Dictionary tab's two sections — a read-only,
// paginated view of the full dictionary, and the Historical Orphans
// cleanup tool.
export async function MasterDictionary() {
  const [dictionaryRows, orphanRows, dictionaryOptions] = await Promise.all([
    getMasterDictionaryRows(),
    getOrphanSpares(),
    getDictionaryOptions(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <MasterDictionaryTable rows={dictionaryRows} />
      <OrphanSparesTable rows={orphanRows} dictionaryOptions={dictionaryOptions} />
    </div>
  )
}
