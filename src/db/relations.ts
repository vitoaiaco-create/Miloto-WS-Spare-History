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
    oilConsumptionLogs: r.many.oilConsumptionLogsTable({
      from: r.assetsTable.id,
      to: r.oilConsumptionLogsTable.assetId,
    }),
    oilSamples: r.many.oilSamplesTable({
      from: r.assetsTable.id,
      to: r.oilSamplesTable.assetId,
    }),
    // Two foreign keys on monthly pairings both point at assets, so each
    // side carries the same alias to keep trailer and truck distinct.
    trailerPairings: r.many.monthlyPairingsTable({
      from: r.assetsTable.id,
      to: r.monthlyPairingsTable.trailerId,
      alias: "trailer",
    }),
    truckPairings: r.many.monthlyPairingsTable({
      from: r.assetsTable.id,
      to: r.monthlyPairingsTable.truckId,
      alias: "truck",
    }),
    tireIncidents: r.many.tireIncidentsTable({
      from: r.assetsTable.id,
      to: r.tireIncidentsTable.assetId,
    }),
    tirePenalties: r.many.tirePenaltiesTable({
      from: r.assetsTable.id,
      to: r.tirePenaltiesTable.assetId,
    }),
  },
  driversTable: {
    monthlyPairings: r.many.monthlyPairingsTable({
      from: r.driversTable.id,
      to: r.monthlyPairingsTable.driverId,
    }),
    tireIncidents: r.many.tireIncidentsTable({
      from: r.driversTable.id,
      to: r.tireIncidentsTable.driverId,
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
  oilConsumptionLogsTable: {
    // `assetId` is `NOT NULL` with `onDelete: "cascade"` in schema.ts, so an
    // oil consumption log can never exist without its asset.
    asset: r.one.assetsTable({
      from: r.oilConsumptionLogsTable.assetId,
      to: r.assetsTable.id,
      optional: false,
    }),
  },
  oilSamplesTable: {
    // `assetId` is `NOT NULL` with `onDelete: "cascade"` in schema.ts, so an
    // oil sample can never exist without its asset.
    asset: r.one.assetsTable({
      from: r.oilSamplesTable.assetId,
      to: r.assetsTable.id,
      optional: false,
    }),
  },
  monthlyPairingsTable: {
    trailer: r.one.assetsTable({
      from: r.monthlyPairingsTable.trailerId,
      to: r.assetsTable.id,
      optional: false,
      alias: "trailer",
    }),
    truck: r.one.assetsTable({
      from: r.monthlyPairingsTable.truckId,
      to: r.assetsTable.id,
      optional: false,
      alias: "truck",
    }),
    driver: r.one.driversTable({
      from: r.monthlyPairingsTable.driverId,
      to: r.driversTable.id,
      optional: false,
    }),
  },
  tireIncidentsTable: {
    asset: r.one.assetsTable({
      from: r.tireIncidentsTable.assetId,
      to: r.assetsTable.id,
      optional: false,
    }),
    driver: r.one.driversTable({
      from: r.tireIncidentsTable.driverId,
      to: r.driversTable.id,
      optional: false,
    }),
  },
  tirePenaltiesTable: {
    asset: r.one.assetsTable({
      from: r.tirePenaltiesTable.assetId,
      to: r.assetsTable.id,
      optional: false,
    }),
  },
}));
