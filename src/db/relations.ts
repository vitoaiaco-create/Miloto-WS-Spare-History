import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

// Relationships between tables, used by Drizzle's relational query API
// (e.g. `db.query.assetsTable.findMany({ with: { mechanicalSpares: true } })`).
export const relations = defineRelations(schema, (r) => ({
  assetsTable: {
    mileageLogs: r.many.mileageLogsTable({
      from: r.assetsTable.id,
      to: r.mileageLogsTable.assetId,
    }),
    mechanicalSpares: r.many.mechanicalSparesTable({
      from: r.assetsTable.id,
      to: r.mechanicalSparesTable.assetId,
    }),
  },
  mileageLogsTable: {
    // `assetId` is `NOT NULL` with `onDelete: "cascade"` in schema.ts, so a
    // mileage log can never exist without its asset.
    asset: r.one.assetsTable({
      from: r.mileageLogsTable.assetId,
      to: r.assetsTable.id,
      optional: false,
    }),
  },
  mechanicalSparesTable: {
    // `assetId` is `NOT NULL` with `onDelete: "cascade"` in schema.ts, so a
    // spare can never exist without its asset.
    asset: r.one.assetsTable({
      from: r.mechanicalSparesTable.assetId,
      to: r.assetsTable.id,
      optional: false,
    }),
  },
}));
