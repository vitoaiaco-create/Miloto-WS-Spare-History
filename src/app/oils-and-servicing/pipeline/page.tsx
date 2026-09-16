import { auth } from "@clerk/nextjs/server"
import { subDays } from "date-fns"
import { and, desc, eq, gte, inArray, or } from "drizzle-orm"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import {
  SamplingPipelineBoard,
  type PipelineSample,
} from "@/components/sampling-pipeline-board"
import { Button } from "@/components/ui/button"
import { db } from "@/db"
import { assetsTable, oilSamplesTable } from "@/db/schema"

export default async function SamplingPipelinePage() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const allowedModules = sessionClaims?.metadata?.modules || []

  if (!allowedModules.includes("oils_servicing")) {
    redirect("/")
  }

  // Active pipeline cards stay on the board indefinitely. Received
  // samples older than 7 days are left in the table for reporting but
  // dropped here so the Results Received column does not grow without bound.
  const receivedArchiveCutoff = subDays(new Date(), 7)

  const rows = await db
    .select({
      id: oilSamplesTable.id,
      assetId: oilSamplesTable.assetId,
      assetName: assetsTable.assetName,
      status: oilSamplesTable.status,
      createdAt: oilSamplesTable.createdAt,
    })
    .from(oilSamplesTable)
    .innerJoin(assetsTable, eq(oilSamplesTable.assetId, assetsTable.id))
    .where(
      or(
        inArray(oilSamplesTable.status, ["requested", "drawn", "sent"]),
        and(
          eq(oilSamplesTable.status, "received"),
          gte(oilSamplesTable.createdAt, receivedArchiveCutoff)
        )
      )
    )
    .orderBy(desc(oilSamplesTable.createdAt))

  const samples: PipelineSample[] = rows.map((row) => ({
    id: row.id,
    assetId: row.assetId,
    assetName: row.assetName,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }))

  return (
    <main className="flex-1 bg-zinc-50 dark:bg-black">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-16 sm:px-10 lg:px-16">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          nativeButton={false}
          render={<Link href="/oils-and-servicing" />}
        >
          <ArrowLeft data-icon="inline-start" />
          Oils &amp; Servicing
        </Button>

        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
            Sampling pipeline
          </h1>
          <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Track every single sample
          </p>
        </div>

        <SamplingPipelineBoard samples={samples} />
      </section>
    </main>
  )
}
