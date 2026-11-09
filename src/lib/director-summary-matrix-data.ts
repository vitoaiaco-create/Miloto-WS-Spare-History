import "server-only"

import { auth } from "@clerk/nextjs/server"
import { and, eq, gte, lt, lte } from "drizzle-orm"

import { db } from "@/db"
import {
  assetsTable,
  manualAlignmentEventsTable,
  mechanicalSparesTable,
  workshopEvents,
} from "@/db/schema"
import { analyticsPeriodLabel } from "@/lib/analytics-period"
import {
  aggregateDirectorSummaryMatrix,
  type DirectorSummaryMatrixPayload,
} from "@/lib/director-summary-matrix"
import { formatIsoDate } from "@/lib/iso-date"
import {
  addWorkshopDays,
  toWorkshopDay,
  toWorkshopEventMatrixInput,
  workshopDayStart,
} from "@/lib/workshop-events"

function monthBounds(year: number, month: number) {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`
  const endDate = formatIsoDate(new Date(year, month, 0))
  return { startDate, endDate }
}

export async function getDirectorSummaryMatrix(
  year: number,
  month: number
): Promise<DirectorSummaryMatrixPayload> {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const { startDate, endDate } = monthBounds(year, month)

  // `workshop_events.event_date` is a timestamp; widen the month to whole
  // workshop days so events near midnight land on the right calendar day.
  const workshopStart = workshopDayStart(startDate)
  const workshopEnd = workshopDayStart(addWorkshopDays(endDate, 1))
  if (!workshopStart || !workshopEnd) {
    throw new Error("Could not resolve the workshop month bounds")
  }

  const [spares, manualEvents, workshopEventRows] = await Promise.all([
    db
      .select({
        assetName: assetsTable.assetName,
        date: mechanicalSparesTable.outwardDate,
        subEquipment: mechanicalSparesTable.subEquipment,
      })
      .from(mechanicalSparesTable)
      .innerJoin(
        assetsTable,
        eq(mechanicalSparesTable.assetId, assetsTable.id)
      )
      .where(
        and(
          gte(mechanicalSparesTable.outwardDate, startDate),
          lte(mechanicalSparesTable.outwardDate, endDate)
        )
      ),
    db
      .select({
        assetName: assetsTable.assetName,
        date: manualAlignmentEventsTable.date,
        eventType: manualAlignmentEventsTable.eventType,
        outOfSquareAxle1: manualAlignmentEventsTable.outOfSquareAxle1,
        outOfSquareAxle2: manualAlignmentEventsTable.outOfSquareAxle2,
        outOfSquareAxle3: manualAlignmentEventsTable.outOfSquareAxle3,
      })
      .from(manualAlignmentEventsTable)
      .innerJoin(
        assetsTable,
        eq(manualAlignmentEventsTable.assetId, assetsTable.id)
      )
      .where(
        and(
          gte(manualAlignmentEventsTable.date, startDate),
          lte(manualAlignmentEventsTable.date, endDate)
        )
      ),
    // Technician-logged events from the Workshop Events page.
    db
      .select({
        assetName: assetsTable.assetName,
        eventDate: workshopEvents.eventDate,
        eventCategory: workshopEvents.eventCategory,
        eventOutcome: workshopEvents.eventOutcome,
      })
      .from(workshopEvents)
      .innerJoin(assetsTable, eq(workshopEvents.assetId, assetsTable.id))
      .where(
        and(
          gte(workshopEvents.eventDate, workshopStart),
          lt(workshopEvents.eventDate, workshopEnd)
        )
      ),
  ])

  const workshopManualEvents = workshopEventRows.flatMap((row) => {
    const mapped = toWorkshopEventMatrixInput(
      row.eventCategory,
      row.eventOutcome
    )
    return mapped
      ? [
          {
            assetName: row.assetName,
            date: toWorkshopDay(row.eventDate),
            ...mapped,
          },
        ]
      : []
  })

  return {
    ...aggregateDirectorSummaryMatrix(
      spares,
      [...manualEvents, ...workshopManualEvents],
      year,
      month
    ),
    periodLabel: analyticsPeriodLabel({ year, month }),
  }
}
