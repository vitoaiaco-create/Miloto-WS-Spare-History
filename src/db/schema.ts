import {
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
export const mechanicalSparesTable = pgTable(
  "mechanical_spares",
  {
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
    // The outward report's "Price ($)" and "Amount ($)" columns. These are
    // what the Spares History table displays; `costKwacha` is retained as
    // the local-currency figure for future reporting. Nullable because the
    // report leaves the dollar cells blank on some lines, and a fitment
    // record is still worth keeping without them.
    priceUsd: numeric("price_usd", { precision: 12, scale: 2 }),
    costUsd: numeric("cost_usd", { precision: 12, scale: 2 }),
    tier1: varchar("tier_1", { length: 100 }).notNull(),
    tier2: varchar("tier_2", { length: 100 }).notNull(),
    tier3: varchar("tier_3", { length: 100 }).notNull(),
    // Physical installation point on the asset (e.g. "Front Left", "Axle 2").
    // Not present in the source CSV; captured for future part-lifespan
    // calculations keyed to a specific fitment location.
    installationPoint: varchar("installation_point", { length: 255 }),
  },
  (table) => [
    // Identifies one line of the outward report, so re-importing a report
    // tops up rather than duplicating what's already on file. Verified
    // unique across all 465 rows of the 2026 master report — note the
    // report's own "SNo" column is not unique and can't serve as the key.
    uniqueIndex("mechanical_spares_job_card_part_date_idx").on(
      table.jobCardNo,
      table.partNumber,
      table.fitmentDate
    ),
  ]
);

// Lab-sample workflow for the Oils & Servicing module. A sample is logged
// as `drawn` when workshop staff take it, then moves through processed /
// sent / received as the lab handles it.
export const sampleStatusEnum = pgEnum("sample_status", [
  "drawn",
  "processed",
  "sent",
  "received",
]);

// Litres (or other units) of oil issued against a job card. `assetId` is a
// foreign key to `assetsTable.id` — the same normalized identifier used by
// mileage logs and mechanical spares — even though staff enter a fleet
// number (varchar) in the UI.
export const oilConsumptionLogsTable = pgTable(
  "oil_consumption_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    recordDate: timestamp("record_date").notNull(),
    quantity: real("quantity").notNull(),
    jobCardNo: varchar("job_card_no", { length: 50 }).notNull(),
  },
  (table) => [
    // One oil issue per asset / job card / date, so re-importing a
    // consumption report tops up rather than duplicating what's on file.
    uniqueIndex("oil_consumption_logs_asset_job_date_idx").on(
      table.assetId,
      table.jobCardNo,
      table.recordDate
    ),
  ]
);

// Oil samples drawn from an asset for lab analysis. Status defaults to
// `drawn` so a manual log is immediately on the workflow; `notes` is
// optional because the Central Hub form only captures the fleet number and
// the date the sample was taken.
export const oilSamplesTable = pgTable("oil_samples", {
  id: uuid().primaryKey().defaultRandom(),
  assetId: integer("asset_id")
    .notNull()
    .references(() => assetsTable.id, { onDelete: "cascade" }),
  drawnDate: timestamp("drawn_date").notNull(),
  status: sampleStatusEnum("status").notNull().default("drawn"),
  notes: text("notes"),
});
