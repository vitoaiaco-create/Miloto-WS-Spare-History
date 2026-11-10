"use server"

import { auth, clerkClient } from "@clerk/nextjs/server"
import { and, desc, eq, gte, lt } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/db"
import { assetsTable, workshopEvents } from "@/db/schema"
import { classifyStatementAssetType } from "@/lib/spares-statement"
import {
  buildWheelAlignmentOutcome,
  canUseWorkshopEvents,
  getAlignmentAxles,
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

// Out-of-square reading in mm/m; negative values are valid.
const axleMeasurementSchema = z
  .number({ error: "Axle measurement must be a number" })
  .finite()
  .min(-100)
  .max(100)
  .nullish()

const logWorkshopEventSchema = z
  .object({
    assetId: z.number({ error: "Asset is required" }).int().positive(),
    eventCategory: eventCategorySchema,
    eventOutcome: z.string({ error: "Outcome is required" }).trim().min(1),
    eventDate: z.date({ error: "Event date is required" }),
    axle1: axleMeasurementSchema,
    axle2: axleMeasurementSchema,
    axle3: axleMeasurementSchema,
  })
  .refine(
    // Backdating is allowed; the future is not. Anything up to the end of
    // today's workshop day passes.
    (value) => value.eventDate < getWorkshopDayBounds().end,
    { message: "Event date cannot be in the future", path: ["eventDate"] }
  )
  .refine(
    // A Wheel Alignment outcome is derived from the axle measurements below,
    // so only the other categories need their outcome checked here.
    (value) =>
      value.eventCategory === "Wheel Alignment" ||
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
  eventOutcome: string,
  eventDate: Date,
  // Wheel Alignment only: out-of-square readings in mm/m. Ignored for other
  // categories.
  axle1?: number,
  axle2?: number,
  axle3?: number
): Promise<{ id: number }> {
  const { userId } = await requireWorkshopEventsAccess()

  const data = logWorkshopEventSchema.parse({
    assetId,
    eventCategory,
    eventOutcome,
    eventDate,
    axle1,
    axle2,
    axle3,
  })

  const [asset] = await db
    .select({ id: assetsTable.id, assetName: assetsTable.assetName })
    .from(assetsTable)
    .where(eq(assetsTable.id, data.assetId))
    .limit(1)
  if (!asset) throw new Error("Asset not found")

  let finalOutcome = data.eventOutcome
  if (data.eventCategory === "Wheel Alignment") {
    // Drop readings for axles the unit doesn't have (e.g. Axle 1 on a
    // prime mover) so a stray value can never fail an alignment.
    const axles = getAlignmentAxles(asset.assetName)
    finalOutcome = buildWheelAlignmentOutcome({
      axle1: axles.includes(1) ? data.axle1 : undefined,
      axle2: axles.includes(2) ? data.axle2 : undefined,
      axle3: axles.includes(3) ? data.axle3 : undefined,
    }).outcome
  }

  const [created] = await db
    .insert(workshopEvents)
    .values({
      assetId: data.assetId,
      eventCategory: data.eventCategory,
      eventOutcome: finalOutcome,
      // `createdAt` is deliberately not set: it defaults to the moment of
      // system entry and drives "Today's Logs" / undo.
      eventDate: data.eventDate,
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
    eventDate: event.eventDate,
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

  // Postgres `DISTINCT ON (asset_id)` ordered by `event_date DESC` keeps only
  // the newest in-window event per asset (`id DESC` breaks same-instant
  // ties). The category and date filters sit inside this subquery rather
  // than in the outer WHERE so the LEFT JOIN below still returns assets that
  // have no matching event.
  const latestEvents = db
    .selectDistinctOn([workshopEvents.assetId], {
      assetId: workshopEvents.assetId,
      eventDate: workshopEvents.eventDate,
      eventOutcome: workshopEvents.eventOutcome,
    })
    .from(workshopEvents)
    .where(
      and(
        eq(workshopEvents.eventCategory, data.eventCategory),
        gte(workshopEvents.eventDate, windowStart),
        lt(workshopEvents.eventDate, windowEnd)
      )
    )
    .orderBy(
      workshopEvents.assetId,
      desc(workshopEvents.eventDate),
      desc(workshopEvents.id)
    )
    .as("latest_events")

  const rows = await db
    .select({
      assetId: assetsTable.id,
      assetName: assetsTable.assetName,
      assetType: assetsTable.assetType,
      lastEventDate: latestEvents.eventDate,
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
      assetType: row.assetType,
      lastEventDate: row.lastEventDate,
      lastEventOutcome: row.lastEventOutcome,
    }))
    .sort((left, right) =>
      left.assetName.localeCompare(right.assetName, undefined, {
        numeric: true,
      })
    )
}
