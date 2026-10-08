import "server-only"

import { auth } from "@clerk/nextjs/server"
import { and, eq, gte, lte } from "drizzle-orm"

import { db } from "@/db"
import {
  assetsTable,
  manualAlignmentEventsTable,
  mechanicalSparesTable,
} from "@/db/schema"
import { analyticsPeriodLabel } from "@/lib/analytics-period"
import {
  aggregateDirectorSummaryMatrix,
  type DirectorSummaryMatrixPayload,
} from "@/lib/director-summary-matrix"
import { formatIsoDate } from "@/lib/iso-date"

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

  const [spares, manualEvents] = await Promise.all([
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
  ])

  return {
    ...aggregateDirectorSummaryMatrix(spares, manualEvents, year, month),
    periodLabel: analyticsPeriodLabel({ year, month }),
  }
}
