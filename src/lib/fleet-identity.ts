import "server-only"

import { eq, ilike, or, type SQL } from "drizzle-orm"

import { assetsTable } from "@/db/schema"

// Source identities look like "MT124(TRAILER124)", but ingestion stores
// trailers as `MT124` with `assetType = "Trailer"`. Match both so the
// motive/towed split is consistent everywhere it's used — Workshop
// Analytics spend reports (src/actions/analytics.ts) and the Logistics
// Tyre Damages chart (src/actions/logistics.ts).
//
// Lives in a plain lib module (not a `"use server"` actions file) because
// it returns a Drizzle `SQL` fragment rather than data, and every export
// of a `"use server"` file must be an async Server Action.
export function trailerIdentityFilter(): SQL {
  const filter = or(
    ilike(assetsTable.assetName, "%TRAILER%"),
    eq(assetsTable.assetType, "Trailer")
  )

  if (!filter) {
    throw new Error("Trailer identity filter is required")
  }

  return filter
}
