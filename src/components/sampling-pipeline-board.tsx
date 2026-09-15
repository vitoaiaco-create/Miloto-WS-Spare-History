"use client"

import { useState } from "react"
import { formatDistanceToNow } from "date-fns"

import { advanceSampleStatus } from "@/actions/ingestion"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "@/components/ui/toast"

export const SAMPLE_PIPELINE_COLUMNS = [
  { status: "requested", title: "Requested" },
  { status: "drawn", title: "Drawn" },
  { status: "sent", title: "Sent to Lab" },
  { status: "received", title: "Results Received" },
] as const

export type PipelineSampleStatus = (typeof SAMPLE_PIPELINE_COLUMNS)[number]["status"]

export type PipelineSample = {
  id: string
  assetId: number
  assetName: string
  status: PipelineSampleStatus
  createdAt: string
}

const NEXT_STATUS_LABEL: Record<Exclude<PipelineSampleStatus, "received">, string> =
  {
    requested: "drawn",
    drawn: "sent to lab",
    sent: "results received",
  }

export function SamplingPipelineBoard({ samples }: { samples: PipelineSample[] }) {
  const byStatus = Object.fromEntries(
    SAMPLE_PIPELINE_COLUMNS.map((column) => [
      column.status,
      samples.filter((sample) => sample.status === column.status),
    ])
  ) as Record<PipelineSampleStatus, PipelineSample[]>

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {SAMPLE_PIPELINE_COLUMNS.map((column) => {
        const columnSamples = byStatus[column.status]

        return (
          <section
            key={column.status}
            className="flex min-h-72 flex-col gap-3 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/10"
          >
            <header className="flex items-center justify-between gap-2 px-1">
              <h2 className="text-sm font-medium tracking-tight">
                {column.title}
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {columnSamples.length}
              </span>
            </header>

            {columnSamples.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">No samples</p>
            ) : (
              <div className="flex flex-col gap-3">
                {columnSamples.map((sample) => (
                  <PipelineSampleCard key={sample.id} sample={sample} />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function PipelineSampleCard({ sample }: { sample: PipelineSample }) {
  const [isPending, setIsPending] = useState(false)
  const requestedAgo = formatDistanceToNow(new Date(sample.createdAt), {
    addSuffix: true,
  })

  async function onAdvance() {
    setIsPending(true)

    try {
      const result = await advanceSampleStatus(
        sample.id,
        String(sample.assetId),
        sample.status
      )

      const description =
        result.status === "drawn" && result.odometer !== null
          ? `${sample.assetName} marked as drawn. Odometer ${result.odometer.toLocaleString("en-US")} km captured from mileage logs.`
          : `${sample.assetName} moved to ${NEXT_STATUS_LABEL[sample.status as Exclude<PipelineSampleStatus, "received">]}.`

      toast.add({
        title: "Sample updated",
        description,
        type: "success",
      })
    } catch (error) {
      toast.add({
        title: "Could not advance sample",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while updating the sample.",
        type: "error",
      })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{sample.assetName}</CardTitle>
        <CardDescription>Requested {requestedAgo}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          Asset ID {sample.assetId}
        </p>
      </CardContent>
      {sample.status !== "received" ? (
        <CardFooter>
          <Button
            size="sm"
            className="w-full"
            disabled={isPending}
            onClick={onAdvance}
          >
            {isPending ? "Moving…" : "Move to Next Stage"}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}
