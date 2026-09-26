import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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

// Lab-sample workflow for the Oils & Servicing module. A sample starts as
// `requested` from the Oils dashboard, then moves drawn → sent → received
// on the sampling pipeline board.
export const sampleStatusEnum = pgEnum("sample_status", [
  "requested",
  "drawn",
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

// Oil samples drawn from an asset for lab analysis. Dashboard "Request
// Sample" inserts `requested` with no odometer; mileage is stamped when
// the sample is marked `drawn`. `notes` is optional.
export const oilSamplesTable = pgTable("oil_samples", {
  id: uuid().primaryKey().defaultRandom(),
  assetId: integer("asset_id")
    .notNull()
    .references(() => assetsTable.id, { onDelete: "cascade" }),
  // Set when the sample is physically drawn. Null while status is
  // `requested`.
  drawnDate: timestamp("drawn_date"),
  // Truck kilometres at the moment the sample is physically drawn. Null
  // until then; locked in so the compliance clock is not affected by later
  // mileage-log edits.
  odometer: integer("odometer"),
  status: sampleStatusEnum("status").notNull().default("requested"),
  notes: text("notes"),
  // Insert time — used by the pipeline board as "time since the request".
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Manual monthly kilometre override for a single asset (broken odometer).
// Raw daily hops stay in `mileage_logs`; `manual_distance` supersedes that
// computed total for scoring when it is not null. One row per asset / month;
// `month_year` is always the 1st of that month.
export const monthlyAssetDistancesTable = pgTable(
  "monthly_asset_distances",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    monthYear: date("month_year").notNull(),
    manualDistance: integer("manual_distance"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("monthly_asset_distances_asset_id_month_year_idx").on(
      table.assetId,
      table.monthYear
    ),
    check(
      "monthly_asset_distances_month_year_first_day",
      sql`extract(day from ${table.monthYear}) = 1`
    ),
    check(
      "monthly_asset_distances_manual_distance_nonneg",
      sql`${table.manualDistance} is null or ${table.manualDistance} >= 0`
    ),
  ]
);

// Manual monthly fleet-wide kilometre totals entered in Workshop Analytics.
// One row per calendar month; `month_year` is always the 1st of that month.
export const monthlyFleetKmTable = pgTable(
  "monthly_fleet_km",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    monthYear: date("month_year").notNull(),
    totalKm: integer("total_km").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("monthly_fleet_km_month_year_idx").on(table.monthYear),
    check(
      "monthly_fleet_km_month_year_first_day",
      sql`extract(day from ${table.monthYear}) = 1`
    ),
  ]
);

// Drivers assigned to truck/trailer pairings and credited on tire penalties.
export const driversTable = pgTable("drivers", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Which trailer, truck, and driver operated together in a given month.
// One trailer has at most one pairing per month.
export const monthlyPairingsTable = pgTable(
  "monthly_pairings",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    trailerId: integer("trailer_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    truckId: integer("truck_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    driverId: integer("driver_id")
      .notNull()
      .references(() => driversTable.id, { onDelete: "cascade" }),
    activeMonth: date("active_month").notNull(),
  },
  (table) => [
    uniqueIndex("monthly_pairings_trailer_id_active_month_idx").on(
      table.trailerId,
      table.activeMonth
    ),
  ]
);

// Processed tire-scrapping penalties imported from the scrap CSV.
// `assetId` is the fleet unit the scrap is charged against; `amount` is
// the penalty points (only non-zero deductions are stored). `visualId`
// is the scrap's identifier in the source file, so re-importing tops up
// rather than duplicating.
export const tirePenaltiesTable = pgTable(
  "tire_penalties",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    date: timestamp("date").notNull(),
    reason: varchar("reason", { length: 255 }).notNull(),
    visualId: varchar("visual_id", { length: 100 }).notNull(),
  },
  (table) => [
    uniqueIndex("tire_penalties_visual_id_idx").on(table.visualId),
  ]
);

// Manual tire-penalty log. `assetId` is the fleet unit the incident is
// charged against; `driverId` is the driver credited with the penalty.
export const tireIncidentsTable = pgTable("tire_incidents", {
  id: uuid().primaryKey().defaultRandom(),
  assetId: integer("asset_id")
    .notNull()
    .references(() => assetsTable.id, { onDelete: "cascade" }),
  driverId: integer("driver_id")
    .notNull()
    .references(() => driversTable.id, { onDelete: "cascade" }),
  incidentDate: timestamp("incident_date").notNull(),
  penaltyType: varchar("penalty_type", { length: 255 }).notNull(),
  penaltyPoints: integer("penalty_points").notNull(),
  notes: text("notes"),
});
