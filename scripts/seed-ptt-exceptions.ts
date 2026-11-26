import "dotenv/config"

import { drizzle } from "drizzle-orm/neon-http"

import { pttApprovedExceptionsTable } from "../src/db/schema"
import {
  FLEET_WIDE_EXCEPTION_SEEDS,
  SEED_APPROVED_BY,
} from "../src/lib/ptt/exception-seed-data"

// Idempotent seed of the confirmed fleet-wide PTT approved exceptions.
// Run with: npx tsx scripts/seed-ptt-exceptions.ts
//
// `ON CONFLICT DO NOTHING` hits the partial unique index on active
// (generation, canonical_key) rows, so re-running never duplicates a row and
// never overwrites a proof note someone edited later.

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to seed PTT exceptions")
}

const db = drizzle(process.env.DATABASE_URL)

async function main() {
  const inserted = await db
    .insert(pttApprovedExceptionsTable)
    .values(
      FLEET_WIDE_EXCEPTION_SEEDS.map((seed) => ({
        scope: "FLEET_GENERATION" as const,
        generation: seed.generation,
        fleetId: null,
        canonicalKey: seed.canonicalKey,
        reasonCategory: seed.reasonCategory,
        physicalProofNote: seed.physicalProofNote,
        approvedBy: SEED_APPROVED_BY,
      }))
    )
    .onConflictDoNothing()
    .returning({ id: pttApprovedExceptionsTable.id })

  console.log(
    `Seeded ${inserted.length} new fleet-wide exception(s); ${
      FLEET_WIDE_EXCEPTION_SEEDS.length - inserted.length
    } already existed.`
  )
}

main().catch((error) => {
  console.error("Seeding PTT exceptions failed:", error)
  process.exit(1)
})
