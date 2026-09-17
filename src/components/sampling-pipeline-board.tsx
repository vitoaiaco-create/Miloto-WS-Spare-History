"use client"

import { useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { Trash2, Undo2 } from "lucide-react"

import {
  advanceSampleStatus,
  deleteSampleRequest,
  reverseSampleStatus,
} from "@/actions/ingestion"
import { ExportPipelineColumnMenu } from "@/components/export-table-menu"
import { ShareTableButton } from "@/components/share-oil-table-button"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "@/components/ui/toast"

export const SAMPLE_PIPELINE_COLUMNS = [
  { id: "requested", status: "requested", title: "Requested", emptyLabel: "No samples" },
  { id: "drawn", status: "drawn", title: "Drawn", emptyLabel: "No samples" },
  { id: "sent", status: "sent", title: "Sent to Lab", emptyLabel: "No samples" },
  {
    id: "received",
    status: "received",
    title: "Results Received",
    emptyLabel: "No recent results",
  },
] as const

export type PipelineSampleStatus = (typeof SAMPLE_PIPELINE_COLUMNS)[number]["status"]

export type PipelineSample = {
  id: string
  assetId: number
  assetName: string
  status: PipelineSampleStatus
  createdAt: string
  currentKm: number | null
  oilRunningKm: number | null
}

const NEXT_STATUS_LABEL: Record<Exclude<PipelineSampleStatus, "received">, string> =
  {
    requested: "drawn",
    drawn: "sent to lab",
    sent: "results received",
  }

const PREV_STATUS_LABEL: Record<Exclude<PipelineSampleStatus, "requested">, string> =
  {
    drawn: "requested",
    sent: "drawn",
    received: "sent to lab",
  }

const FORWARD_ACTION_LABEL: Record<
  Exclude<PipelineSampleStatus, "received">,
  string
> = {
  requested: "Mark as Drawn",
  drawn: "Mark as Sent",
  sent: "Mark as Received",
}

function formatCardKm(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—"

  return Math.round(value).toLocaleString("en-US")
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
        const columnDomId = `pipeline-col-${column.id}`

        return (
          <section
            key={column.status}
            className="flex min-h-72 flex-col gap-3 rounded-xl bg-muted/40 p-3 ring-1 ring-foreground/10"
          >
            <header className="flex items-center justify-between gap-2 px-1">
              <h2 className="text-sm font-medium tracking-tight">
                {column.title}
              </h2>
              <div className="flex items-center gap-0.5">
                <ShareTableButton
                  targetId={columnDomId}
                  compact
                  fileName={`sampling-pipeline-${column.id}.png`}
                  shareTitle={column.title}
                  notFoundDescription={`Could not find the ${column.title} column.`}
                />
                <ExportPipelineColumnMenu
                  rows={columnSamples}
                  columnTitle={column.title}
                />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {columnSamples.length}
                </span>
              </div>
            </header>

            <div id={columnDomId} className="flex flex-col gap-3">
              {columnSamples.length === 0 ? (
                <p className="px-1 text-sm text-muted-foreground">
                  {column.emptyLabel}
                </p>
              ) : (
                columnSamples.map((sample) => (
                  <PipelineSampleCard key={sample.id} sample={sample} />
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function PipelineSampleCard({ sample }: { sample: PipelineSample }) {
  const [pendingAction, setPendingAction] = useState<
    "forward" | "reverse" | "delete" | null
  >(null)
  const isPending = pendingAction !== null
  const requestedAgo = formatDistanceToNow(new Date(sample.createdAt), {
    addSuffix: true,
  })

  async function onAdvance() {
    setPendingAction("forward")

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
      setPendingAction(null)
    }
  }

  async function onReverse() {
    setPendingAction("reverse")

    try {
      await reverseSampleStatus(sample.id, sample.status)

      toast.add({
        title: "Sample updated",
        description: `${sample.assetName} moved back to ${PREV_STATUS_LABEL[sample.status as Exclude<PipelineSampleStatus, "requested">]}.`,
        type: "success",
      })
    } catch (error) {
      toast.add({
        title: "Could not undo sample",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while reversing the sample.",
        type: "error",
      })
    } finally {
      setPendingAction(null)
    }
  }

  async function onCancel() {
    setPendingAction("delete")

    try {
      await deleteSampleRequest(sample.id)

      toast.add({
        title: "Sample cancelled",
        description: `${sample.assetName} request was removed.`,
        type: "success",
      })
    } catch (error) {
      toast.add({
        title: "Could not cancel sample",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while cancelling the sample.",
        type: "error",
      })
    } finally {
      setPendingAction(null)
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
        {sample.status !== "requested" ? (
          <div className="mt-1 flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">
              Current Mileage: {formatCardKm(sample.currentKm)}
            </p>
            <p className="text-xs text-muted-foreground">
              Oil Running KM: {formatCardKm(sample.oilRunningKm)}
            </p>
          </div>
        ) : null}
        <div className="flex justify-between items-center gap-2 mt-4">
          {sample.status === "requested" ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={isPending}
              onClick={onCancel}
            >
              <Trash2 data-icon="inline-start" />
              {pendingAction === "delete" ? "Cancelling…" : "Cancel"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={onReverse}
            >
              <Undo2 data-icon="inline-start" />
              {pendingAction === "reverse" ? "Undoing…" : "Undo"}
            </Button>
          )}
          {sample.status !== "received" ? (
            <Button size="sm" disabled={isPending} onClick={onAdvance}>
              {pendingAction === "forward"
                ? "Moving…"
                : FORWARD_ACTION_LABEL[sample.status]}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
