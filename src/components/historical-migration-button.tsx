"use client"

import { useTransition } from "react"
import { Loader2Icon } from "lucide-react"

import { migrateHistoricalEvents } from "@/actions/admin-upload"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

// TEMPORARY: one-time trigger for `migrateHistoricalEvents`. Remove this
// component (and its use on the Data Ingestion page) once the legacy
// alignments / air system checks have been copied across.
export function HistoricalMigrationButton() {
  const [isPending, startTransition] = useTransition()

  function run() {
    startTransition(async () => {
      try {
        const migrated = await migrateHistoricalEvents()

        toast.add({
          title: "Historical migration complete",
          description: `${migrated} historical ${
            migrated === 1 ? "row was" : "rows were"
          } successfully migrated.`,
          type: "success",
        })
      } catch (error) {
        toast.add({
          title: "Historical migration failed",
          description:
            error instanceof Error ? error.message : "Something went wrong.",
          type: "error",
        })
      }
    })
  }

  return (
    <Button
      variant="outline"
      className="self-start"
      disabled={isPending}
      onClick={run}
    >
      {isPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
      Run One-Time Historical Migration
    </Button>
  )
}
