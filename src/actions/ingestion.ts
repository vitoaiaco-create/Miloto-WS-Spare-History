"use server"

import { auth } from "@clerk/nextjs/server"
import { inArray } from "drizzle-orm"

import { db } from "@/db"
import { assetsTable, mechanicalSparesTable, mileageLogsTable } from "@/db/schema"
import {
  bulkMileageSchema,
  bulkSparesSchema,
  type MileageRow,
  type SparesRow,
} from "@/lib/validations"

// Formats a validated `Date` as the `YYYY-MM-DD` string expected by the
// `date`/`fitmentDate` columns (both declared with the default `date()`
// mode in `src/db/schema.ts`, which stores/returns plain date strings).
function toIsoDateString(date: Date) {
  return date.toISOString().slice(0, 10)
}

// Spreadsheet rows identify an asset by its fleet number (e.g. "MTL-01"),
// but `mechanicalSparesTable`/`mileageLogsTable` reference it via the
// numeric `assetsTable.id` foreign key. This resolves every fleet number in
// a batch to its `assetId` in one query, and throws — rather than silently
// creating an asset with guessed details — if a fleet number isn't
// registered yet, since asset records are managed elsewhere.
async function resolveAssetIdsByFleetNumber(fleetNumbers: string[]) {
  const uniqueFleetNumbers = [...new Set(fleetNumbers)]

  const assets = await db
    .select({ id: assetsTable.id, assetName: assetsTable.assetName })
    .from(assetsTable)
    .where(inArray(assetsTable.assetName, uniqueFleetNumbers))

  const assetIdByFleetNumber = new Map(
    assets.map((asset) => [asset.assetName, asset.id] as const)
  )

  const missingFleetNumbers = uniqueFleetNumbers.filter(
    (fleetNumber) => !assetIdByFleetNumber.has(fleetNumber)
  )

  if (missingFleetNumbers.length > 0) {
    throw new Error(
      `Unknown fleet number(s): ${missingFleetNumbers.join(", ")}. Add the asset(s) before importing.`
    )
  }

  return assetIdByFleetNumber
}

function toSpareInsertValues(
  row: SparesRow,
  assetIdByFleetNumber: Map<string, number>
) {
  return {
    assetId: assetIdByFleetNumber.get(row.fleetNumber)!,
    fitmentDate: toIsoDateString(row.fitmentDate),
    partNumber: row.partNumber,
    materialName: row.materialName,
    jobCardNo: row.jobCardNo,
    // `quantity`/`costKwacha` are `numeric()` columns, which Drizzle
    // represents as strings by default (see src/db/schema.ts) — the Zod
    // schema validates them as numbers, so we convert back here.
    quantity: row.quantity.toString(),
    costKwacha: row.costKwacha.toString(),
    tier1: row.tier1,
    tier2: row.tier2,
    tier3: row.tier3,
    installationPoint: row.installationPoint ?? null,
  }
}

function toMileageInsertValues(
  row: MileageRow,
  assetIdByFleetNumber: Map<string, number>
) {
  return {
    assetId: assetIdByFleetNumber.get(row.fleetNumber)!,
    date: toIsoDateString(row.date),
    odometer: row.odometer.toString(),
  }
}

// Bulk-imports the "Spares Outward List" spreadsheet into
// `mechanicalSparesTable`.
export async function ingestSpares(rawData: unknown[]) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const parsedData = bulkSparesSchema.parse(rawData)

  const assetIdByFleetNumber = await resolveAssetIdsByFleetNumber(
    parsedData.map((row) => row.fleetNumber)
  )

  await db
    .insert(mechanicalSparesTable)
    .values(
      parsedData.map((row) => toSpareInsertValues(row, assetIdByFleetNumber))
    )

  return { success: true, count: parsedData.length }
}

// Bulk-imports the "Daily Mileage Log" spreadsheet into `mileageLogsTable`.
export async function ingestMileage(rawData: unknown[]) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const parsedData = bulkMileageSchema.parse(rawData)

  const assetIdByFleetNumber = await resolveAssetIdsByFleetNumber(
    parsedData.map((row) => row.fleetNumber)
  )

  await db
    .insert(mileageLogsTable)
    .values(
      parsedData.map((row) => toMileageInsertValues(row, assetIdByFleetNumber))
    )

  return { success: true, count: parsedData.length }
}
