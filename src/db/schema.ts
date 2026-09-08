import {
  date,
  integer,
  numeric,
  pgTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// Heavy transport units (e.g. prime movers, trailers) in the fleet.
export const assetsTable = pgTable("assets", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  assetName: varchar("asset_name", { length: 255 }).notNull().unique(),
  assetType: varchar("asset_type", { length: 100 }).notNull(),
});

// Daily odometer readings for each asset.
// `assetId` is a foreign key to `assetsTable.id`, giving each asset a
// one-to-many relationship with its mileage logs.
export const mileageLogsTable = pgTable(
  "mileage_logs",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    odometer: numeric("odometer", { precision: 12, scale: 2 }).notNull(),
  },
  (table) => [
    // Prevents duplicate readings for the same asset on the same day.
    uniqueIndex("mileage_logs_asset_id_date_idx").on(
      table.assetId,
      table.date
    ),
  ]
);

// Workshop spares issued to the fleet (outward stock movements).
// `assetId` is a foreign key to `assetsTable.id`, giving each asset a
// one-to-many relationship with its mechanical spares history.
export const mechanicalSparesTable = pgTable("mechanical_spares", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  assetId: integer("asset_id")
    .notNull()
    .references(() => assetsTable.id, { onDelete: "cascade" }),
  fitmentDate: date("fitment_date").notNull(),
  partNumber: varchar("part_number", { length: 100 }).notNull(),
  materialName: varchar("material_name", { length: 255 }).notNull(),
  jobCardNo: varchar("job_card_no", { length: 50 }).notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
  costKwacha: numeric("cost_kwacha", { precision: 12, scale: 2 }).notNull(),
  tier1: varchar("tier_1", { length: 100 }).notNull(),
  tier2: varchar("tier_2", { length: 100 }).notNull(),
  tier3: varchar("tier_3", { length: 100 }).notNull(),
  // Physical installation point on the asset (e.g. "Front Left", "Axle 2").
  // Not present in the source CSV; captured for future part-lifespan
  // calculations keyed to a specific fitment location.
  installationPoint: varchar("installation_point", { length: 255 }),
});
