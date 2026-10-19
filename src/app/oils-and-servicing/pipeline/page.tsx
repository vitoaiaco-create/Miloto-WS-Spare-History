import { auth } from "@clerk/nextjs/server"
import { subDays } from "date-fns"
import { and, desc, eq, gte, inArray, or } from "drizzle-orm"
import { redirect } from "next/navigation"

import {
  SamplingPipelineBoard,
  type PipelineSample,
} from "@/components/sampling-pipeline-board"
import { db } from "@/db"
import { assetsTable, oilSamplesTable } from "@/db/schema"
import { getPipelineSampleMetrics } from "@/lib/oil-analytics"

export default async function SamplingPipelinePage() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const allowedModules = sessionClaims?.metadata?.modules || []
  const isOilsOnly = sessionClaims?.metadata?.role === "oils_only"

  if (!isOilsOnly && !allowedModules.includes("oils_servicing")) {
    redirect("/")
  }

  // Active pipeline cards stay on the board indefinitely. Received
  // samples last updated more than 14 days ago are left in the table for
  // reporting but dropped here so the Results Received column does not
  // grow without bound. Filter on `updatedAt` (status-change time), not
  // `createdAt` (original request time), or cards vanish as soon as they
  // move into this column if the request is older than the window.
  const receivedArchiveCutoff = subDays(new Date(), 14)

  const rows = await db
    .select({
      id: oilSamplesTable.id,
      assetId: oilSamplesTable.assetId,
      assetName: assetsTable.assetName,
      status: oilSamplesTable.status,
      createdAt: oilSamplesTable.createdAt,
      odometer: oilSamplesTable.odometer,
      drawnDate: oilSamplesTable.drawnDate,
    })
    .from(oilSamplesTable)
    .innerJoin(assetsTable, eq(oilSamplesTable.assetId, assetsTable.id))
    .where(
      or(
        inArray(oilSamplesTable.status, ["requested", "drawn", "sent"]),
        and(
          eq(oilSamplesTable.status, "received"),
          gte(oilSamplesTable.updatedAt, receivedArchiveCutoff)
        )
      )
    )
    .orderBy(desc(oilSamplesTable.createdAt))

  const metricsById = await getPipelineSampleMetrics(rows)

  const samples: PipelineSample[] = rows.map((row) => {
    const metrics = metricsById.get(row.id)

    return {
      id: row.id,
      assetId: row.assetId,
      assetName: row.assetName,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      currentKm: metrics?.currentKm ?? row.odometer,
      oilRunningKm: metrics?.oilRunningKm ?? null,
    }
  })

  return (
    <>
      <div className="flex flex-col gap-2 print:hidden">
        <h2 className="text-xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Sampling pipeline
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Track every single sample
        </p>
      </div>

      <SamplingPipelineBoard samples={samples} />
    </>
  )
}
