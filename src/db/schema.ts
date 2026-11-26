import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import {
  HR_DISCIPLINARY_STATUSES,
  type HrDisciplinaryStatus,
} from "../lib/hr-disciplinary";
import {
  PTT_ATTACHMENT_ROLES,
  PTT_CODE_FORMATS,
  PTT_FAULT_SEVERITIES,
  PTT_FAULT_STATES,
  PTT_OVERALL_SEVERITIES,
  PTT_SESSION_STATUSES,
  PTT_TRUCK_GENERATIONS,
  type PttAttachmentRole,
  type PttCodeFormat,
  type PttDirective,
  type PttFaultSeverity,
  type PttFaultState,
  type PttOverallSeverity,
  type PttSessionStatus,
  type PttSparesContextItem,
  type PttTruckGeneration,
  type PttVerificationSummary,
} from "../lib/ptt-diagnostics";
import type {
  PttCaseStatus,
  PttExceptionScope,
  PttGateOverride,
  PttKnownGeneration,
  PttLedgerStatus,
  PttReconciliationBucket,
  PttReconciliationSummary,
  PttScanFaultStatus,
  PttScanRole,
} from "../lib/ptt/constants";
import type { PttVerificationAudit } from "../lib/ptt/verification-audit-schema";

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
// Column order below mirrors the ERP's own "Job Cards OutWard Report"
// layout left-to-right, so the two line up at a glance — with our internal
// identifiers (`id`, `assetId`) pinned to the front and the curated
// taxonomy (`tier1`/`tier2`/`tier3`/`assetClass` — not an ERP column at all;
// owned by the Master Dictionary / Triage Inbox, never by Spares History)
// pinned to the back.
// See `src/lib/validations.ts` (`sparesRowSchema`) for the CSV header each
// ERP-shaped column below is read from.
export const mechanicalSparesTable = pgTable(
  "mechanical_spares",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    // The outward report's own "SNo" line number. Not unique across the
    // report (see the unique index below, which doesn't use it), kept
    // purely for traceability back to the source file. Null on every row
    // imported before the ERP report carried this column.
    sNo: integer("s_no"),
    materialName: varchar("material_name", { length: 255 }).notNull(),
    partNumber: varchar("part_number", { length: 100 }).notNull(),
    // Raw ERP columns, stored verbatim and never overwritten with the
    // curated `tier1`/`tier2`/`tier3` taxonomy at the bottom of this table.
    // `ingestSpares` (src/actions/ingestion.ts) copies the CSV "Sub
    // Equipment" cell into `subEquipment` as-is (after trim) and fills
    // tier1/2/3/assetClass from `masterTaxonomyDictionaryTable` only —
    // never the other way around. Spares History filters and displays
    // `subEquipment`; the Master Dictionary, Triage Inbox, and orphan
    // cleanup own the taxonomy columns. Null on historical rows imported
    // before the ERP report carried these columns.
    category: text("category"),
    subCategory: text("sub_category"),
    jobCardType: text("job_card_type"),
    subEquipment: text("sub_equipment"),
    // Warehouse / store from the ERP outward report's "Location" column.
    // Stored verbatim. Null on historical rows imported before the report
    // carried this column, and on blank cells.
    location: text("location"),
    // Parsed from `location` at ingest time by `parseFitmentLocation`
    // (src/lib/location-parser.ts). Null when the raw cell is blank or
    // doesn't mention an axle / side. Never overwrite `location`.
    fitmentAxle: integer("fitment_axle"),
    fitmentSide: text("fitment_side"),
    brandName: text("brand_name"),
    supplierName: text("supplier_name"),
    docketNo: text("docket_no"),
    // Raw ERP strings, kept verbatim and unparsed. `assetId` above is the
    // resolved fleet-asset foreign key the rest of the app actually joins
    // on; these two are not normalized against it.
    vehicleNo: text("vehicle_no"),
    identityNo: text("identity_no"),
    odometer: integer("odometer"),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    exRate: numeric("ex_rate", { precision: 12, scale: 4 }),
    // Renamed from `costKwacha` — the generated migration issues a RENAME
    // COLUMN (not a drop/add) so the ~14,000 existing rows keep their value.
    priceKwacha: numeric("price_kwacha", { precision: 12, scale: 2 }).notNull(),
    amountKwacha: numeric("amount_kwacha", { precision: 12, scale: 2 }),
    // The outward report's "Price ($)" and "Amount ($)" columns. These are
    // what the Spares History table displays. Nullable because the report
    // leaves the dollar cells blank on some lines, and a fitment record is
    // still worth keeping without them.
    priceUsd: numeric("price_usd", { precision: 12, scale: 2 }),
    // Renamed from `costUsd` — the generated migration issues a RENAME
    // COLUMN (not a drop/add) so existing rows keep their value.
    amountUsd: numeric("amount_usd", { precision: 12, scale: 2 }),
    // Renamed from `fitmentDate` — the generated migration issues a RENAME
    // COLUMN (not a drop/add) so the ~14,000 existing rows keep their value.
    outwardDate: date("outward_date").notNull(),
    jobCardNo: varchar("job_card_no", { length: 50 }).notNull(),
    issuedBy: text("issued_by"),
    collectedBy: text("collected_by"),
    returnQuantity: numeric("return_quantity", { precision: 10, scale: 2 }),
    // Physical installation point on the asset (e.g. "Front Left", "Axle 2").
    // Not present in the source CSV; captured for future part-lifespan
    // calculations keyed to a specific fitment location.
    installationPoint: varchar("installation_point", { length: 255 }),
    // Master Dictionary / Triage Inbox classification. Never filled from
    // the ERP "Sub Equipment" cell — that lives in `subEquipment` above.
    tier1: varchar("tier_1", { length: 100 }).notNull(),
    tier2: varchar("tier_2", { length: 100 }).notNull(),
    tier3: varchar("tier_3", { length: 100 }).notNull(),
    // Dictionary-owned classification. Populated by `ingestSpares` (and
    // `backfillMechanicalSparesTaxonomy` in src/actions/dictionary-seed.ts)
    // from `masterTaxonomyDictionaryTable`, matched on part number — not
    // from the ERP "Sub Equipment"/"Category"/"Sub-Category" columns.
    // Nullable because a spare whose part number isn't in the dictionary
    // yet has no canonical asset class to backfill.
    assetClass: varchar("asset_class", { length: 100 }),
  },
  (table) => [
    // Identifies one line of the outward report, so re-importing a report
    // tops up rather than duplicating what's already on file. Verified
    // unique across all 465 rows of the 2026 master report — note the
    // report's own "SNo" column is not unique and can't serve as the key.
    uniqueIndex("mechanical_spares_job_card_part_date_idx").on(
      table.jobCardNo,
      table.partNumber,
      table.outwardDate
    ),
  ]
);

// Director-facing replacements for cryptic ERP part descriptions on
// executive statements. Shared across all staff; keyed by a normalized
// material name so the same wording always prints the same way.
export const partDescriptionAliasesTable = pgTable(
  "part_description_aliases",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    sourceName: varchar("source_name", { length: 255 }).notNull(),
    normalizedName: varchar("normalized_name", { length: 255 })
      .notNull()
      .unique(),
    alias: varchar("alias", { length: 255 }).notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // Audit only — never used to hide aliases from other staff.
    updatedBy: varchar("updated_by", { length: 255 }),
  }
);

// Manual interventions injected into the executive statement (wheel
// alignments, routine checks, checks pending, air system tests). Shared
// across all staff.
// Not a stock movement — these sit alongside physical spare replacements,
// sorted by date. Existing rows default to wheel alignment.
export const MANUAL_STATEMENT_EVENT_TYPES = [
  "WHEEL_ALIGNMENT",
  "CHECKS_OK",
  "CHECKS_PENDING",
  "AIR_SYSTEM_OK",
  "AIR_SYSTEM_FAIL",
] as const;

export const manualStatementEventTypeEnum = pgEnum(
  "manual_statement_event_type",
  MANUAL_STATEMENT_EVENT_TYPES
);

export const manualAlignmentEventsTable = pgTable(
  "manual_alignment_events",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    eventType: manualStatementEventTypeEnum("event_type")
      .notNull()
      .default("WHEEL_ALIGNMENT"),
    notes: text("notes"),
    // Wheel-alignment out-of-square readings in mm/m. Null on
    // CHECKS_OK / CHECKS_PENDING / AIR_SYSTEM_OK / AIR_SYSTEM_FAIL
    // rows and on alignments logged before these metrics were
    // captured. Trucks / prime movers typically use axle 2 and 3
    // (rear axles); trailers use 1–3.
    outOfSquareAxle1: real("out_of_square_axle_1"),
    outOfSquareAxle2: real("out_of_square_axle_2"),
    outOfSquareAxle3: real("out_of_square_axle_3"),
  },
  (table) => [
    // Lets the "Upload Alignments CSV" bulk import in `ingestAlignments`
    // (src/actions/ingestion.ts) re-run the same file without double-
    // counting: a row is skipped via `.onConflictDoNothing()` once its
    // asset/date/event type is already on file. Scoped to all three columns
    // (rather than just asset+date) so a wheel alignment and a checks note
    // can still both be logged for the same asset on the same day.
    uniqueIndex("manual_alignment_events_asset_date_type_idx").on(
      table.assetId,
      table.date,
      table.eventType
    ),
  ]
);

// Manual workshop checks logged by technicians from the Workshop Events
// page. Shared across all staff. `createdBy` is the Clerk user id of whoever
// logged it — used only to decide who may undo an event, never to hide rows
// from other staff. Distinct from `manualAlignmentEventsTable`, which feeds
// the executive statement.
//
// Allowed `eventCategory` / `eventOutcome` values live in
// src/lib/workshop-events.ts (`WORKSHOP_EVENT_OUTCOMES`) and are enforced by
// Zod in the Server Actions.
export const workshopEvents = pgTable("workshop_events", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id")
    .references(() => assetsTable.id, { onDelete: "cascade" })
    .notNull(),
  eventCategory: varchar("event_category", { length: 50 }).notNull(), // 'Wheel Alignment', 'Air System Check', 'Injector Trim Codes' or 'General Checks'
  // e.g. 'PREVENTATIVE MAINT - AIR SYSTEM TEST OK' or, for alignments,
  // 'WHEEL ALIGNMENT (FAILED) - Out of Square - Axle 1: -3.5 mm/m - Axle 2: ...'
  // (can exceed 100 chars with all three axles, hence 255).
  eventOutcome: varchar("event_outcome", { length: 255 }).notNull(),
  // When the check actually happened (technicians may backdate it).
  // `createdAt` stays the exact moment of system entry.
  eventDate: timestamp("event_date").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: text("created_by").notNull(),
});

// Consumables (nuts, bolts, electrodes, etc.) permanently omitted from
// executive statements. Shared across all staff. A spare is hidden when
// its part number OR material name matches an entry — history rows are
// never deleted.
export const statementConsumableExclusionsTable = pgTable(
  "statement_consumable_exclusions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    partNumber: varchar("part_number", { length: 100 }).notNull(),
    materialName: varchar("material_name", { length: 255 }).notNull(),
    normalizedPartNumber: varchar("normalized_part_number", { length: 100 })
      .notNull(),
    normalizedMaterialName: varchar("normalized_material_name", {
      length: 255,
    }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // Audit only — never used to hide exclusions from other staff.
    createdBy: varchar("created_by", { length: 255 }),
  },
  (table) => [
    uniqueIndex("statement_consumable_exclusions_part_number_idx").on(
      table.normalizedPartNumber
    ),
    uniqueIndex("statement_consumable_exclusions_material_name_idx").on(
      table.normalizedMaterialName
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
  // Last status change. The sampling pipeline keeps `received` cards
  // visible for 14 days from this timestamp, not from `createdAt`.
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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

// Raw landing table for the Python-generated "Monthly Asset Pairings" CSV
// uploaded from the admin ingestion page (`uploadMonthlyPairings` in
// src/actions/admin-upload.ts). `truckId` / `trailerId` are resolved from the
// CSV's fleet-number strings to `assetsTable.id`; `driverName` stays the raw
// CSV text. Unlike `monthlyPairingsTable` above (which the Logistics scoring
// reads), nothing here is unique or non-null — `uploadMonthlyPairings` also
// mirrors each fully-resolved row into `monthlyPairingsTable` so the Asset
// Rankings pick it up.
export const monthlyAssetPairings = pgTable("monthly_asset_pairings", {
  id: serial("id").primaryKey(),
  activeMonth: date("active_month").notNull(),
  truckId: integer("truck_id").references(() => assetsTable.id),
  trailerId: integer("trailer_id").references(() => assetsTable.id),
  driverName: text("driver_name"),
});

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
// Master taxonomy lookup imported from `Final_Master_Dictionary.csv` (see
// `seedMasterTaxonomyDictionary` in src/actions/dictionary-seed.ts). Keyed on
// `partNumber` — normalized to trimmed/upper-case at import time — so the
// same dictionary file can be re-run at any time to top up or correct
// classifications without duplicating rows. Shared across all staff; not
// linked to `mechanicalSparesTable` by a foreign key since the dictionary
// may list part numbers that haven't been issued yet.
export const masterTaxonomyDictionaryTable = pgTable(
  "master_taxonomy_dictionary",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    partNumber: text("part_number").notNull(),
    materialName: text("material_name"),
    standardizedMaterialName: text("standardized_material_name"),
    tier1: text("tier_1"),
    tier2: text("tier_2"),
    tier3: text("tier_3"),
    brandName: text("brand_name"),
    assetClass: text("asset_class"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // The seed script's `onConflictDoUpdate` match key — one row per Part
    // Number, so re-seeding updates existing classifications in place.
    uniqueIndex("master_taxonomy_dictionary_part_number_idx").on(
      table.partNumber
    ),
  ]
);

// Rows from the daily mechanical spares CSV upload (`ingestSpares` in
// src/actions/ingestion.ts) whose Part Number did not match
// `masterTaxonomyDictionaryTable`. Sits in the Triage Inbox
// (src/components/triage-inbox.tsx) until a staff member picks a Tier 1/2/3
// and Asset Class for the part; "Commit & Learn" then upserts that choice
// into the dictionary, inserts the spare into `mechanicalSparesTable`, and
// deletes this row (see `commitUnmappedSpare` in src/actions/triage.ts).
// Columns otherwise mirror `mechanicalSparesTable` (same ERP-layout order,
// same front/back pinning of internal ids and taxonomy) minus the taxonomy
// fields, which is exactly what's missing until triage happens. Shared
// across all staff, like every other table in this file.
export const unmappedSparesStagingTable = pgTable(
  "unmapped_spares_staging",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => assetsTable.id, { onDelete: "cascade" }),
    sNo: integer("s_no"),
    materialName: varchar("material_name", { length: 255 }).notNull(),
    partNumber: varchar("part_number", { length: 100 }).notNull(),
    category: text("category"),
    subCategory: text("sub_category"),
    jobCardType: text("job_card_type"),
    subEquipment: text("sub_equipment"),
    // Warehouse / store from the ERP outward report's "Location" column.
    // Stored verbatim. Null on historical rows imported before the report
    // carried this column, and on blank cells.
    location: text("location"),
    // Parsed from `location` at ingest time by `parseFitmentLocation`
    // (src/lib/location-parser.ts). Null when the raw cell is blank or
    // doesn't mention an axle / side. Never overwrite `location`.
    fitmentAxle: integer("fitment_axle"),
    fitmentSide: text("fitment_side"),
    brandName: text("brand_name"),
    supplierName: text("supplier_name"),
    docketNo: text("docket_no"),
    vehicleNo: text("vehicle_no"),
    identityNo: text("identity_no"),
    odometer: integer("odometer"),
    quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
    exRate: numeric("ex_rate", { precision: 12, scale: 4 }),
    // Renamed from `costKwacha` — the generated migration issues a RENAME
    // COLUMN (not a drop/add) so existing rows keep their value.
    priceKwacha: numeric("price_kwacha", { precision: 12, scale: 2 }).notNull(),
    amountKwacha: numeric("amount_kwacha", { precision: 12, scale: 2 }),
    priceUsd: numeric("price_usd", { precision: 12, scale: 2 }),
    // Renamed from `costUsd` — the generated migration issues a RENAME
    // COLUMN (not a drop/add) so existing rows keep their value.
    amountUsd: numeric("amount_usd", { precision: 12, scale: 2 }),
    // Renamed from `fitmentDate` — the generated migration issues a RENAME
    // COLUMN (not a drop/add) so existing rows keep their value.
    outwardDate: date("outward_date").notNull(),
    jobCardNo: varchar("job_card_no", { length: 50 }).notNull(),
    issuedBy: text("issued_by"),
    collectedBy: text("collected_by"),
    returnQuantity: numeric("return_quantity", { precision: 10, scale: 2 }),
    installationPoint: varchar("installation_point", { length: 255 }),
    // Only "pending" is written today — a row is deleted outright once
    // Commit & Learn processes it rather than being marked some other
    // status. Kept as a column (instead of inferring state from the row's
    // mere presence) so a future "ignored" workflow has somewhere to land
    // without another migration.
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // Mirrors `mechanical_spares_job_card_part_date_idx` so re-uploading the
    // same CSV tops up rather than re-staging a part that's already
    // awaiting triage.
    uniqueIndex("unmapped_spares_staging_job_card_part_date_idx").on(
      table.jobCardNo,
      table.partNumber,
      table.outwardDate
    ),
  ]
);

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

// Allowed `hr_disciplinary_cases.status` values live in the client-safe
// src/lib/hr-disciplinary.ts so Client Components never import this schema.
// Re-exported for server code that still imports them from here. (Relative
// path: drizzle-kit loads this file without the `@/` alias.)
export { HR_DISCIPLINARY_STATUSES };
export type { HrDisciplinaryStatus };

// Automated HR Charges: one row per disciplinary case generated from a
// charge screenshot. Shared across all staff (admin-gated at the page level).
// `documentPayload` stores the 7 docxtemplater template fields (driver_name,
// employee_no, date, incident_details, formatted_charges, penalty_amount,
// deduction_clause) so the .docx files can be re-generated and re-downloaded
// later. `createdBy` is audit-only (Clerk user id).
export const hrDisciplinaryCasesTable = pgTable("hr_disciplinary_cases", {
  id: serial("id").primaryKey(),
  caseRef: text("case_ref").notNull().unique(),
  fleetId: text("fleet_id").notNull(),
  employeeNo: text("employee_no").notNull(),
  driverName: text("driver_name").notNull(),
  status: text("status")
    .$type<HrDisciplinaryStatus>()
    .notNull()
    .default("AWAITING_SIGNATURE"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
  disputeNote: text("dispute_note"),
  documentPayload: jsonb("document_payload")
    .$type<Record<string, string>>()
    .notNull(),
  createdBy: text("created_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Signed paperwork / dispute statements uploaded against a case. Files live
// in blob storage; this table only keeps the pointers and metadata.
export const hrDisciplinaryAttachmentsTable = pgTable(
  "hr_disciplinary_attachments",
  {
    id: serial("id").primaryKey(),
    caseId: integer("case_id")
      .notNull()
      .references(() => hrDisciplinaryCasesTable.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    // e.g. 'Signed Notice of Charge', 'Signed Notice of Penalty',
    // 'Dispute Statement' or 'Other'.
    docLabel: text("doc_label").notNull(),
    blobPathname: text("blob_pathname").notNull(),
    blobUrl: text("blob_url").notNull(),
    contentType: text("content_type").notNull(),
    fileSize: integer("file_size").notNull(),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  }
);

// Allowed Fleet Diagnostics (PTT Intel) enum-like values live in the
// client-safe src/lib/ptt-diagnostics.ts so Client Components never import
// this schema. Re-exported for server code. (Relative path: drizzle-kit
// loads this file without the `@/` alias.)
export {
  PTT_ATTACHMENT_ROLES,
  PTT_CODE_FORMATS,
  PTT_FAULT_SEVERITIES,
  PTT_FAULT_STATES,
  PTT_OVERALL_SEVERITIES,
  PTT_SESSION_STATUSES,
  PTT_TRUCK_GENERATIONS,
};
export type {
  PttAttachmentRole,
  PttCodeFormat,
  PttFaultSeverity,
  PttFaultState,
  PttOverallSeverity,
  PttSessionStatus,
  PttTruckGeneration,
};

// Fleet Diagnostics (PTT Intel): one row per Volvo PTT scan session for a
// truck. Shared across all staff. `fleetId` is the canonical uppercase fleet
// number (e.g. `MTL61`) — the same string stored in `assetsTable.assetName` —
// kept as plain text (no FK), like `hr_disciplinary_cases.fleet_id`, so a scan
// can be logged for a truck before it exists in the assets table.
// `scannedBy` is audit-only (Clerk user id).
//
// Closed-loop Before/After reconciliation: a BASELINE session opens a "case"
// (`caseId`); each post-work VERIFICATION session joins the same case and
// points at the baseline through `parentScanId`. `createdBy` / `createdAt` of
// the reconciliation spec are the pre-existing `scannedBy` / `scannedAt`.
export const pttDiagnosticSessionsTable = pgTable(
  "ptt_diagnostic_sessions",
  {
  id: serial("id").primaryKey(),
  fleetId: text("fleet_id").notNull(),
  // `generation` of the reconciliation spec.
  truckGeneration: text("truck_generation")
    .$type<PttTruckGeneration>()
    .notNull()
    .default("UNKNOWN"),
  // Groups a baseline and its verification scan(s). Existing rows each get
  // their own case id from the column default.
  caseId: uuid("case_id").notNull().defaultRandom(),
  scanRole: text("scan_role").$type<PttScanRole>().notNull().default("BASELINE"),
  // The case's baseline scan (set on verification scans only). Verification
  // scans are meaningless without it, so they go away with it.
  parentScanId: integer("parent_scan_id").references(
    (): AnyPgColumn => pttDiagnosticSessionsTable.id,
    { onDelete: "cascade" }
  ),
  // "DTC List (N Items)" as printed in the PTT header; null when unreadable.
  headerItemCount: integer("header_item_count"),
  // Distinct DTC rows (unique canonical keys) extracted from the screenshots.
  extractedItemCount: integer("extracted_item_count").notNull().default(0),
  // headerItemCount === null || extractedItemCount >= headerItemCount.
  isCompleteScan: boolean("is_complete_scan").notNull().default(true),
  // OCR of the PTT bottom status bar (chassis / work order) and top-right
  // product time.
  chassisIdOcr: text("chassis_id_ocr"),
  workOrderOcr: text("work_order_ocr"),
  productTimeOcr: text("product_time_ocr"),
  // SHA-256 (hex) of every uploaded image, to catch recycled screenshots.
  imageHashes: text("image_hashes").array().notNull().default(sql`'{}'::text[]`),
  // Case-level verdict. Kept equal on the baseline and its verification scans.
  caseStatus: text("case_status")
    .$type<PttCaseStatus>()
    .notNull()
    .default("OPEN"),
  reconciliationSummary: jsonb(
    "reconciliation_summary"
  ).$type<PttReconciliationSummary>(),
  // Forensic VERIFICATION_AUDIT (Pass 2, mode B) of a verification scan; null
  // on baselines, on older scans and when the audit call failed.
  verificationAudit: jsonb("verification_audit").$type<PttVerificationAudit>(),
  // Audit log of integrity gates a manager overrode (with the reason given).
  gateOverrides: jsonb("gate_overrides")
    .$type<PttGateOverride[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  odometerKm: integer("odometer_km"),
  // e.g. 'Nov 2026 Fleet Sweep'.
  scanBatchLabel: text("scan_batch_label"),
  // Optional driver complaint or what mechanics want to replace.
  workshopContext: text("workshop_context"),
  status: text("status")
    .$type<PttSessionStatus>()
    .notNull()
    .default("SCANNED"),
  overallSeverity: text("overall_severity")
    .$type<PttOverallSeverity>()
    .notNull()
    .default("CLEAR"),
  criticalCount: integer("critical_count").notNull().default(0),
  calibrationCount: integer("calibration_count").notNull().default(0),
  monitorCount: integer("monitor_count").notNull().default(0),
  negligibleCount: integer("negligible_count").notNull().default(0),
  // Snapshot of the 90-day spares issued that were passed to OpenAI.
  sparesContextSnapshot: jsonb("spares_context_snapshot").$type<
    PttSparesContextItem[]
  >(),
  // The structured 4-part directive object.
  aiDirective: jsonb("ai_directive").$type<PttDirective>(),
  // Before/After re-scan verification result.
  verificationSummary: jsonb(
    "verification_summary"
  ).$type<PttVerificationSummary>(),
  verifiedAt: timestamp("verified_at"),
  scannedBy: text("scanned_by"),
  scannedAt: timestamp("scanned_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("ptt_diagnostic_sessions_case_id_idx").on(table.caseId),
    index("ptt_diagnostic_sessions_fleet_id_idx").on(table.fleetId),
    index("ptt_diagnostic_sessions_parent_scan_id_idx").on(table.parentScanId),
    // Serves the recycled-image lookup (`image_hashes && ARRAY[...]`).
    index("ptt_diagnostic_sessions_image_hashes_idx").using(
      "gin",
      table.imageHashes
    ),
  ]
);

// Individual fault codes extracted from a PTT scan session.
export const pttFaultCodesTable = pgTable("ptt_fault_codes", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => pttDiagnosticSessionsTable.id, { onDelete: "cascade" }),
  fleetId: text("fleet_id").notNull(),
  // Normalized uppercase, e.g. `U300054` or `PSID 200 FMI 12`.
  faultCode: text("fault_code").notNull(),
  codeFormat: text("code_format").$type<PttCodeFormat>().notNull().default("OTHER"),
  // e.g. `EMS`, `TECU`, `APM`, `MID 130`.
  controlUnit: text("control_unit").notNull(),
  componentDescription: text("component_description").notNull(),
  faultState: text("fault_state")
    .$type<PttFaultState>()
    .notNull()
    .default("UNKNOWN"),
  occurrenceCount: integer("occurrence_count"),
  severity: text("severity").$type<PttFaultSeverity>().notNull(),
  rootCauseSummary: text("root_cause_summary").notNull(),
  calibrationRequired: boolean("calibration_required").notNull().default(false),
  resolvedOnRescan: boolean("resolved_on_rescan").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Scan screenshots / PDFs uploaded against a session. Files live in blob
// storage; this table only keeps the pointers and metadata.
export const pttSessionAttachmentsTable = pgTable("ptt_session_attachments", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => pttDiagnosticSessionsTable.id, { onDelete: "cascade" }),
  role: text("role")
    .$type<PttAttachmentRole>()
    .notNull()
    .default("INITIAL_SCAN"),
  fileName: text("file_name").notNull(),
  blobPathname: text("blob_pathname").notNull(),
  blobUrl: text("blob_url").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

// Immutable per-scan snapshot of every fault extracted from a PTT scan, keyed
// by the exact canonical key (src/lib/ptt/canonical-key.ts) so Before/After
// diffs never depend on free-text descriptions. Verification scans also carry
// the reconciliation bucket of every baseline fault: a baseline fault that is
// no longer active is stored as a CLEARED row (`isExtracted = false` when it
// was simply absent from the verification screenshots).
export const pttScanFaultsTable = pgTable(
  "ptt_scan_faults",
  {
    id: serial("id").primaryKey(),
    scanId: integer("scan_id")
      .notNull()
      .references(() => pttDiagnosticSessionsTable.id, { onDelete: "cascade" }),
    canonicalKey: text("canonical_key").notNull(),
    ecuLabel: text("ecu_label").notNull(),
    dtcRaw: text("dtc_raw").notNull(),
    description: text("description").notNull().default(""),
    pttStatus: text("ptt_status").$type<PttScanFaultStatus>().notNull(),
    severity: text("severity").$type<PttFaultSeverity>().notNull(),
    reconciliationBucket: text(
      "reconciliation_bucket"
    ).$type<PttReconciliationBucket>(),
    isBounceBack: boolean("is_bounce_back").notNull().default(false),
    // Matched an active approved exception when the scan was reconciled.
    isApprovedException: boolean("is_approved_exception")
      .notNull()
      .default(false),
    // False for a CLEARED baseline fault that was not on the verification
    // screenshots at all.
    isExtracted: boolean("is_extracted").notNull().default(true),
    // The key could not be normalised (or looks like an OCR misread): shown
    // for human review instead of silently breaking the diff.
    keyNeedsReview: boolean("key_needs_review").notNull().default(false),
    keyReviewReason: text("key_review_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ptt_scan_faults_scan_id_canonical_key_idx").on(
      table.scanId,
      table.canonicalKey
    ),
    index("ptt_scan_faults_bucket_idx").on(table.reconciliationBucket),
  ]
);

// Living, truck-level fault history. One row per (truck, canonical key),
// updated on every baseline / verification commit. The scan ids are nullable
// with `set null` so deleting a scan never blocks on the ledger.
export const pttTruckFaultLedgerTable = pgTable(
  "ptt_truck_fault_ledger",
  {
    id: serial("id").primaryKey(),
    fleetId: text("fleet_id").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    ecuLabel: text("ecu_label").notNull(),
    description: text("description").notNull().default(""),
    latestSeverity: text("latest_severity").$type<PttFaultSeverity>().notNull(),
    ledgerStatus: text("ledger_status").$type<PttLedgerStatus>().notNull(),
    firstSeenScanId: integer("first_seen_scan_id").references(
      () => pttDiagnosticSessionsTable.id,
      { onDelete: "set null" }
    ),
    lastSeenScanId: integer("last_seen_scan_id").references(
      () => pttDiagnosticSessionsTable.id,
      { onDelete: "set null" }
    ),
    clearedScanId: integer("cleared_scan_id").references(
      () => pttDiagnosticSessionsTable.id,
      { onDelete: "set null" }
    ),
    firstSeenAt: timestamp("first_seen_at").notNull(),
    lastSeenAt: timestamp("last_seen_at").notNull(),
    clearedAt: timestamp("cleared_at"),
    reopenCount: integer("reopen_count").notNull().default(0),
    lastReopenedAt: timestamp("last_reopened_at"),
  },
  (table) => [
    uniqueIndex("ptt_truck_fault_ledger_fleet_key_idx").on(
      table.fleetId,
      table.canonicalKey
    ),
    index("ptt_truck_fault_ledger_status_idx").on(table.ledgerStatus),
  ]
);

// Approved exceptions: faults that are physically expected on a whole
// generation (FLEET_GENERATION) or on one truck (TRUCK_SPECIFIC), e.g. codes
// caused by a manual air-dryer conversion. Soft-deactivated via `isActive`.
export const pttApprovedExceptionsTable = pgTable(
  "ptt_approved_exceptions",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").$type<PttExceptionScope>().notNull(),
    generation: text("generation").$type<PttKnownGeneration>(),
    fleetId: text("fleet_id"),
    canonicalKey: text("canonical_key").notNull(),
    reasonCategory: text("reason_category").notNull(),
    physicalProofNote: text("physical_proof_note").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at").notNull().defaultNow(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    // At most one ACTIVE exception per key and scope target (re-approving
    // after a deactivation inserts a fresh row).
    uniqueIndex("ptt_approved_exceptions_generation_key_idx")
      .on(table.generation, table.canonicalKey)
      .where(sql`${table.scope} = 'FLEET_GENERATION' and ${table.isActive}`),
    uniqueIndex("ptt_approved_exceptions_fleet_key_idx")
      .on(table.fleetId, table.canonicalKey)
      .where(sql`${table.scope} = 'TRUCK_SPECIFIC' and ${table.isActive}`),
    index("ptt_approved_exceptions_key_idx").on(table.canonicalKey),
    check(
      "ptt_approved_exceptions_scope_target",
      sql`(${table.scope} = 'FLEET_GENERATION' and ${table.generation} is not null and ${table.fleetId} is null) or (${table.scope} = 'TRUCK_SPECIFIC' and ${table.fleetId} is not null)`
    ),
    check(
      "ptt_approved_exceptions_proof_note_not_blank",
      sql`length(btrim(${table.physicalProofNote})) > 0`
    ),
  ]
);
