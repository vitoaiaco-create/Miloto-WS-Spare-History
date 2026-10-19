import "dotenv/config"

import { drizzle } from "drizzle-orm/neon-http"
import { inArray, isNotNull, or, sql } from "drizzle-orm"

import {
  mechanicalSparesTable,
  unmappedSparesStagingTable,
} from "../src/db/schema"
import { parseFitmentLocation } from "../src/lib/location-parser"

const UPDATE_CHUNK_SIZE = 500

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to backfill fitment locations")
}

const db = drizzle(process.env.DATABASE_URL)

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function backfillTable(
  label: string,
  table: typeof mechanicalSparesTable | typeof unmappedSparesStagingTable
) {
  const rows = await db
    .select({
      id: table.id,
      location: table.location,
    })
    .from(table)
    .where(
      or(
        sql`btrim(coalesce(${table.location}, '')) <> ''`,
        isNotNull(table.fitmentAxle),
        isNotNull(table.fitmentSide)
      )
    )

  const groups = new Map<
    string,
    { fitmentAxle: number | null; fitmentSide: string | null; ids: number[] }
  >()

  for (const row of rows) {
    const parsed = parseFitmentLocation(row.location)
    const key = `${parsed.fitmentAxle ?? ""}|${parsed.fitmentSide ?? ""}`
    const group = groups.get(key) ?? {
      fitmentAxle: parsed.fitmentAxle,
      fitmentSide: parsed.fitmentSide,
      ids: [],
    }
    group.ids.push(row.id)
    groups.set(key, group)
  }

  let updated = 0

  for (const group of groups.values()) {
    for (const ids of chunk(group.ids, UPDATE_CHUNK_SIZE)) {
      const written = await db
        .update(table)
        .set({
          fitmentAxle: group.fitmentAxle,
          fitmentSide: group.fitmentSide,
        })
        .where(inArray(table.id, ids))
        .returning({ id: table.id })

      updated += written.length
    }
  }

  console.log(
    `[backfill-fitment-location] ${label}: parsed ${rows.length} row(s), updated ${updated}`
  )
}

async function main() {
  await backfillTable("mechanical_spares", mechanicalSparesTable)
  await backfillTable("unmapped_spares_staging", unmappedSparesStagingTable)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
