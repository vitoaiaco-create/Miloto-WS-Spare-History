import { asc, eq, isNotNull } from "drizzle-orm"

import {
  TriageInboxTable,
  type TriageDictionaryOptions,
  type TriageStagingRow,
} from "@/components/triage-inbox-table"
import { db } from "@/db"
import {
  assetsTable,
  masterTaxonomyDictionaryTable,
  unmappedSparesStagingTable,
} from "@/db/schema"

// Every row still waiting on a human to pick its Tier 1/2/3 and Asset Class
// — see `ingestSpares` in src/actions/ingestion.ts for how a row lands here
// in the first place, and `commitUnmappedSpare` in src/actions/triage.ts for
// how it leaves.
async function getPendingStagingRows(): Promise<TriageStagingRow[]> {
  const rows = await db
    .select({
      id: unmappedSparesStagingTable.id,
      assetName: assetsTable.assetName,
      fitmentDate: unmappedSparesStagingTable.fitmentDate,
      partNumber: unmappedSparesStagingTable.partNumber,
      materialName: unmappedSparesStagingTable.materialName,
      jobCardNo: unmappedSparesStagingTable.jobCardNo,
      quantity: unmappedSparesStagingTable.quantity,
      costKwacha: unmappedSparesStagingTable.costKwacha,
      createdAt: unmappedSparesStagingTable.createdAt,
    })
    .from(unmappedSparesStagingTable)
    .innerJoin(
      assetsTable,
      eq(unmappedSparesStagingTable.assetId, assetsTable.id)
    )
    .where(eq(unmappedSparesStagingTable.status, "pending"))
    // Oldest first, so the longest-waiting parts get triaged before new
    // ones pile up on top of them.
    .orderBy(asc(unmappedSparesStagingTable.createdAt))

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
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

// Dropdown choices for Tier 1/2/3 and Asset Class come from whatever
// `masterTaxonomyDictionaryTable` already has on file rather than a
// hardcoded list — the same vocabulary `seedMasterTaxonomyDictionary`
// (src/actions/dictionary-seed.ts) populated from
// Final_Master_Dictionary.csv, so a staff member's choice in triage can't
// drift from the dictionary's own classifications.
async function getDictionaryOptions(): Promise<TriageDictionaryOptions> {
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

// Server Component: reads `unmappedSparesStagingTable` and the dictionary's
// existing taxonomy values directly (per data-access-patterns.mdc), then
// hands both to the Client Component that renders the editable table and
// wires up "Commit & Learn".
export async function TriageInbox() {
  const [rows, dictionaryOptions] = await Promise.all([
    getPendingStagingRows(),
    getDictionaryOptions(),
  ])

  return <TriageInboxTable rows={rows} dictionaryOptions={dictionaryOptions} />
}
