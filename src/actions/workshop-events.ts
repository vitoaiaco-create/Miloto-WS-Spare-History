"use server"

import { auth, clerkClient } from "@clerk/nextjs/server"
import { and, desc, eq, gte, lt } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/db"
import { assetsTable, workshopEvents } from "@/db/schema"
import { classifyStatementAssetType } from "@/lib/spares-statement"
import {
  canUseWorkshopEvents,
  getWorkshopDayBounds,
  isWorkshopAdmin,
  WORKSHOP_EVENT_CATEGORIES,
  WORKSHOP_EVENT_OUTCOMES,
  type FleetComplianceRow,
  type WorkshopEventAssetOption,
  type WorkshopEventCategory,
  type WorkshopEventRow,
} from "@/lib/workshop-events"

// Exported types and constants live in src/lib/workshop-events.ts ("use
// server" files may only export async functions).

const eventCategorySchema = z.enum(WORKSHOP_EVENT_CATEGORIES, {
  error: "Event category must be Wheel Alignment or Air System Check",
})

const logWorkshopEventSchema = z
  .object({
    assetId: z.number({ error: "Asset is required" }).int().positive(),
    eventCategory: eventCategorySchema,
    eventOutcome: z.string({ error: "Outcome is required" }).trim().min(1),
  })
  .refine(
    (value) =>
      WORKSHOP_EVENT_OUTCOMES[value.eventCategory].includes(
        value.eventOutcome
      ),
    {
      message: "Outcome is not valid for the selected event category",
      path: ["eventOutcome"],
    }
  )

const deleteWorkshopEventSchema = z.object({
  eventId: z.number({ error: "Event is required" }).int().positive(),
})

const fleetComplianceSchema = z
  .object({
    eventCategory: eventCategorySchema,
    startDate: z.date({ error: "Start date is required" }),
    endDate: z.date({ error: "End date is required" }),
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: "Start date must be on or before the end date",
    path: ["startDate"],
  })

// Verifies the Clerk session and that the role may use the technician
// workshop-events tools (admin or workshop_technician).
async function requireWorkshopEventsAccess() {
  const { userId, sessionClaims } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const role = sessionClaims?.metadata?.role
  if (!canUseWorkshopEvents(role)) throw new Error("Forbidden")

  return { userId, isAdmin: isWorkshopAdmin(role) }
}

async function requireAdmin() {
  const { userId, sessionClaims } = await auth()
  if (!userId) throw new Error("Unauthorized")
  if (!isWorkshopAdmin(sessionClaims?.metadata?.role)) {
    throw new Error("Forbidden")
  }

  return { userId }
}

// Resolves Clerk user ids to display names for the "Logged by" column. A
// lookup failure must never break the page, so callers fall back to the id.
async function resolveUserNames(userIds: string[]) {
  const names = new Map<string, string>()
  if (userIds.length === 0) return names

  try {
    const client = await clerkClient()
    const { data } = await client.users.getUserList({
      userId: userIds,
      limit: Math.min(userIds.length, 100),
    })
    for (const user of data) {
      const name =
        user.fullName?.trim() ||
        user.username ||
        user.primaryEmailAddress?.emailAddress
      if (name) names.set(user.id, name)
    }
  } catch {
    // Fall through to raw ids.
  }

  return names
}

// Trucks and Trailers offered in the technician asset dropdown. Cranes and
// unclassified units stay out, matching the executive statement's roster.
export async function getWorkshopEventAssets(): Promise<
  WorkshopEventAssetOption[]
> {
  await requireWorkshopEventsAccess()

  const assets = await db
    .select({
      id: assetsTable.id,
      assetName: assetsTable.assetName,
      assetType: assetsTable.assetType,
    })
    .from(assetsTable)
    .orderBy(assetsTable.assetName)

  return assets.flatMap((asset) => {
    const assetType = classifyStatementAssetType(
      asset.assetType,
      asset.assetName
    )
    return assetType
      ? [{ id: asset.id, assetName: asset.assetName, assetType }]
      : []
  })
}

export async function logWorkshopEvent(
  assetId: number,
  eventCategory: string,
  eventOutcome: string
): Promise<{ id: number }> {
  const { userId } = await requireWorkshopEventsAccess()

  const data = logWorkshopEventSchema.parse({
    assetId,
    eventCategory,
    eventOutcome,
  })

  const [asset] = await db
    .select({ id: assetsTable.id })
    .from(assetsTable)
    .where(eq(assetsTable.id, data.assetId))
    .limit(1)
  if (!asset) throw new Error("Asset not found")

  const [created] = await db
    .insert(workshopEvents)
    .values({
      assetId: data.assetId,
      eventCategory: data.eventCategory,
      eventOutcome: data.eventOutcome,
      createdBy: userId,
    })
    .returning({ id: workshopEvents.id })

  return created
}

// Admins may delete any event. The original creator may delete their own
// event only on the day it was logged (workshop time).
export async function deleteWorkshopEvent(
  eventId: number
): Promise<{ id: number }> {
  const { userId, isAdmin } = await requireWorkshopEventsAccess()

  const data = deleteWorkshopEventSchema.parse({ eventId })

  const [event] = await db
    .select({
      id: workshopEvents.id,
      createdAt: workshopEvents.createdAt,
      createdBy: workshopEvents.createdBy,
    })
    .from(workshopEvents)
    .where(eq(workshopEvents.id, data.eventId))
    .limit(1)
  if (!event) throw new Error("Event not found")

  if (!isAdmin) {
    if (event.createdBy !== userId) {
      throw new Error("You can only delete events you logged")
    }

    const { start, end } = getWorkshopDayBounds()
    if (event.createdAt < start || event.createdAt >= end) {
      throw new Error("You can only delete events on the day they were logged")
    }
  }

  await db.delete(workshopEvents).where(eq(workshopEvents.id, event.id))

  return { id: event.id }
}

export async function getTodayEvents(): Promise<WorkshopEventRow[]> {
  const { userId, isAdmin } = await requireWorkshopEventsAccess()

  const { start, end } = getWorkshopDayBounds()

  const events = await db.query.workshopEvents.findMany({
    where: { createdAt: { gte: start, lt: end } },
    with: { asset: true },
    orderBy: { createdAt: "desc", id: "desc" },
  })

  const names = await resolveUserNames([
    ...new Set(events.map((event) => event.createdBy)),
  ])

  return events.map((event) => ({
    id: event.id,
    assetId: event.assetId,
    assetName: event.asset.assetName,
    assetType: classifyStatementAssetType(
      event.asset.assetType,
      event.asset.assetName
    ),
    eventCategory: event.eventCategory as WorkshopEventCategory,
    eventOutcome: event.eventOutcome,
    createdAt: event.createdAt,
    createdBy: event.createdBy,
    createdByName: names.get(event.createdBy) ?? event.createdBy,
    canDelete: isAdmin || event.createdBy === userId,
  }))
}

// ADMIN ONLY. For every Truck / Trailer, the MOST RECENT event of
// `eventCategory` inside [startDate, endDate], or nulls when there is none.
// Both bounds are widened to whole workshop days (start of the first day
// through the end of the last day), so any instant on the desired day works.
//
// The assets table has no "active" flag, so "active" means every unit
// classified as a Truck or Trailer — the same roster the technician dropdown
// offers.
export async function getFleetCompliance(
  eventCategory: string,
  startDate: Date,
  endDate: Date
): Promise<FleetComplianceRow[]> {
  await requireAdmin()

  const data = fleetComplianceSchema.parse({
    eventCategory,
    startDate,
    endDate,
  })
  const windowStart = getWorkshopDayBounds(data.startDate).start
  const windowEnd = getWorkshopDayBounds(data.endDate).end

  // Postgres `DISTINCT ON (asset_id)` ordered by `created_at DESC` keeps only
  // the newest in-window event per asset (`id DESC` breaks same-instant
  // ties). The category and date filters sit inside this subquery rather
  // than in the outer WHERE so the LEFT JOIN below still returns assets that
  // have no matching event.
  const latestEvents = db
    .selectDistinctOn([workshopEvents.assetId], {
      assetId: workshopEvents.assetId,
      createdAt: workshopEvents.createdAt,
      eventOutcome: workshopEvents.eventOutcome,
    })
    .from(workshopEvents)
    .where(
      and(
        eq(workshopEvents.eventCategory, data.eventCategory),
        gte(workshopEvents.createdAt, windowStart),
        lt(workshopEvents.createdAt, windowEnd)
      )
    )
    .orderBy(
      workshopEvents.assetId,
      desc(workshopEvents.createdAt),
      desc(workshopEvents.id)
    )
    .as("latest_events")

  const rows = await db
    .select({
      assetId: assetsTable.id,
      assetName: assetsTable.assetName,
      assetType: assetsTable.assetType,
      lastEventDate: latestEvents.createdAt,
      lastEventOutcome: latestEvents.eventOutcome,
    })
    .from(assetsTable)
    .leftJoin(latestEvents, eq(latestEvents.assetId, assetsTable.id))

  return rows
    .filter(
      (row) => classifyStatementAssetType(row.assetType, row.assetName) !== null
    )
    .map((row) => ({
      assetId: row.assetId,
      assetName: row.assetName,
      lastEventDate: row.lastEventDate,
      lastEventOutcome: row.lastEventOutcome,
    }))
    .sort((left, right) =>
      left.assetName.localeCompare(right.assetName, undefined, {
        numeric: true,
      })
    )
}
