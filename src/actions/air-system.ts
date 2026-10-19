"use server"

import { auth } from "@clerk/nextjs/server"
import { and, desc, gte, inArray, lte, or, sql } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/db"
import {
  assetsTable,
  manualAlignmentEventsTable,
  mechanicalSparesTable,
} from "@/db/schema"
import {
  classifyAirSystemAssetType,
  compareAirSystemRows,
  type AirSystemComplianceRow,
  type AirSystemComplianceStatus,
  type AirSystemResponseSpare,
} from "@/lib/air-system"
import { parseAnalyticsPeriod } from "@/lib/analytics-period"
import { formatIsoDate } from "@/lib/iso-date"

export type {
  AirSystemAssetType,
  AirSystemComplianceRow,
  AirSystemComplianceStatus,
  AirSystemResponseSpare,
} from "@/lib/air-system"

const getAirSystemComplianceSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Period must be YYYY-MM"),
})

type GetAirSystemComplianceInput = z.infer<typeof getAirSystemComplianceSchema>

const AIR_SYSTEM_EVENT_TYPES = ["AIR_SYSTEM_OK", "AIR_SYSTEM_FAIL"] as const

function monthBounds(period: string) {
  const { year, month } = parseAnalyticsPeriod(period)
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`
  const endDate = formatIsoDate(new Date(year, month, 0))
  return { startDate, endDate }
}

function toQuantity(value: string | number | null | undefined) {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function statusFromEventType(
  eventType: string | undefined
): AirSystemComplianceStatus {
  if (eventType === "AIR_SYSTEM_OK") return "OK"
  if (eventType === "AIR_SYSTEM_FAIL") return "Failed"
  return "Pending"
}

// ERP writes "AIR SYSTEM" in mixed case; the statement title-cases it to
// "Air System". Match either the Sub Equipment or Category cell.
function airSystemSpareFilter() {
  const filter = or(
    sql`lower(btrim(coalesce(${mechanicalSparesTable.subEquipment}, ''))) = 'air system'`,
    sql`lower(btrim(coalesce(${mechanicalSparesTable.category}, ''))) = 'air system'`
  )

  if (!filter) {
    throw new Error("Air system spare filter is required")
  }

  return filter
}

async function requireOilsAndServicingAccess() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    throw new Error("Unauthorized")
  }

  const isOilsOnly = sessionClaims?.metadata?.role === "oils_only"
  const hasOilsModule =
    sessionClaims?.metadata?.modules?.includes("oils_servicing") ?? false

  if (!isOilsOnly && !hasOilsModule) {
    throw new Error("Unauthorized")
  }
}

export async function getAirSystemCompliance(
  period: string
): Promise<AirSystemComplianceRow[]> {
  await requireOilsAndServicingAccess()

  const data: GetAirSystemComplianceInput =
    getAirSystemComplianceSchema.parse({ period })
  const { startDate, endDate } = monthBounds(data.period)

  const assets = await db
    .select({
      id: assetsTable.id,
      assetName: assetsTable.assetName,
      assetType: assetsTable.assetType,
    })
    .from(assetsTable)
    .orderBy(assetsTable.assetName)

  const roster = assets.flatMap((asset) => {
    const assetType = classifyAirSystemAssetType(
      asset.assetType,
      asset.assetName
    )
    return assetType ? [{ ...asset, fleetType: assetType }] : []
  })

  if (roster.length === 0) return []

  const assetIds = roster.map((asset) => asset.id)

  const latestEvents = await db
    .selectDistinctOn([manualAlignmentEventsTable.assetId], {
      assetId: manualAlignmentEventsTable.assetId,
      date: manualAlignmentEventsTable.date,
      eventType: manualAlignmentEventsTable.eventType,
    })
    .from(manualAlignmentEventsTable)
    .where(
      and(
        inArray(manualAlignmentEventsTable.assetId, assetIds),
        inArray(manualAlignmentEventsTable.eventType, [...AIR_SYSTEM_EVENT_TYPES]),
        gte(manualAlignmentEventsTable.date, startDate),
        lte(manualAlignmentEventsTable.date, endDate)
      )
    )
    .orderBy(
      manualAlignmentEventsTable.assetId,
      desc(manualAlignmentEventsTable.date),
      desc(manualAlignmentEventsTable.id)
    )

  const latestByAsset = new Map(
    latestEvents.map((event) => [event.assetId, event])
  )

  const failedAssets = roster.flatMap((asset) => {
    const event = latestByAsset.get(asset.id)
    if (event?.eventType !== "AIR_SYSTEM_FAIL") return []
    return [{ assetId: asset.id, failDate: event.date }]
  })

  const responseSparesByAsset = new Map<number, AirSystemResponseSpare[]>()

  if (failedAssets.length > 0) {
    const failedIds = failedAssets.map((asset) => asset.assetId)
    const earliestFailDate = failedAssets.reduce(
      (earliest, asset) =>
        asset.failDate < earliest ? asset.failDate : earliest,
      failedAssets[0].failDate
    )
    const failDateByAsset = new Map(
      failedAssets.map((asset) => [asset.assetId, asset.failDate])
    )

    const spareRows = await db
      .select({
        assetId: mechanicalSparesTable.assetId,
        materialName: mechanicalSparesTable.materialName,
        quantity: mechanicalSparesTable.quantity,
        outwardDate: mechanicalSparesTable.outwardDate,
      })
      .from(mechanicalSparesTable)
      .where(
        and(
          inArray(mechanicalSparesTable.assetId, failedIds),
          gte(mechanicalSparesTable.outwardDate, earliestFailDate),
          airSystemSpareFilter()
        )
      )
      .orderBy(mechanicalSparesTable.outwardDate, mechanicalSparesTable.id)

    for (const spare of spareRows) {
      const failDate = failDateByAsset.get(spare.assetId)
      if (!failDate || spare.outwardDate < failDate) continue

      const current = responseSparesByAsset.get(spare.assetId) ?? []
      current.push({
        materialName: spare.materialName,
        quantity: toQuantity(spare.quantity),
      })
      responseSparesByAsset.set(spare.assetId, current)
    }
  }

  return roster
    .map((asset) => {
      const event = latestByAsset.get(asset.id)
      const status = statusFromEventType(event?.eventType)

      return {
        assetId: asset.id,
        assetName: asset.assetName,
        assetType: asset.fleetType,
        status,
        dateTested: event?.date ?? null,
        responseSpares:
          status === "Failed"
            ? (responseSparesByAsset.get(asset.id) ?? [])
            : [],
      }
    })
    .sort(compareAirSystemRows)
}
