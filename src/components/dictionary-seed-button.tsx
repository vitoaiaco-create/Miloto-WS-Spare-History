"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"

import {
  backfillMechanicalSparesTaxonomy,
  seedMasterTaxonomyDictionary,
} from "@/actions/dictionary-seed"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "@/components/ui/toast"

type SeedStatus = {
  ok: boolean
  message: string
}

// One-click triggers for the dictionary Server Actions in
// src/actions/dictionary-seed.ts — unlike the other Data Ingestion tabs,
// neither button has a file picker: "Seed Master Dictionary" reads
// `Final_Master_Dictionary.csv` directly off the server's filesystem, and
// "Retroactive Taxonomy Backfill" then re-classifies existing
// `mechanicalSparesTable` rows against whatever the dictionary now holds.
export function DictionarySeedButton() {
  const router = useRouter()
  const [isSeeding, setIsSeeding] = useState(false)
  const [isBackfilling, setIsBackfilling] = useState(false)
  const [status, setStatus] = useState<SeedStatus | null>(null)

  async function handleSeed() {
    if (isSeeding) return

    setIsSeeding(true)
    setStatus(null)

    try {
      const result = await seedMasterTaxonomyDictionary()

      const skippedNote =
        result.totalSkipped > 0
          ? ` ${result.totalSkipped} malformed row${
              result.totalSkipped === 1 ? " was" : "s were"
            } skipped${
              result.skipped[0]
                ? ` (e.g. row ${result.skipped[0].rowNumber}: ${result.skipped[0].error})`
                : ""
            }.`
          : ""

      setStatus({
        ok: true,
        message: `Parsed ${result.totalParsed} row${
          result.totalParsed === 1 ? "" : "s"
        } and upserted ${result.totalUpserted} dictionary record${
          result.totalUpserted === 1 ? "" : "s"
        }.${skippedNote}`,
      })

      router.refresh()
    } catch (error) {
      setStatus({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Something went wrong while seeding the dictionary.",
      })
    } finally {
      setIsSeeding(false)
    }
  }

  // Shows a loading toast immediately, then swaps it for a success/error
  // toast once `backfillMechanicalSparesTaxonomy` resolves — `toast.promise`
  // handles that transition in place rather than stacking a second toast.
  async function handleBackfill() {
    if (isBackfilling) return

    setIsBackfilling(true)

    try {
      const result = await toast.promise(backfillMechanicalSparesTaxonomy(), {
        loading: "Backfilling historical spares from the master dictionary…",
        success: (backfillResult) => ({
          title: "Backfill complete",
          description: `Updated ${backfillResult.updatedCount.toLocaleString()} historical spare record${
            backfillResult.updatedCount === 1 ? "" : "s"
          } with canonical tier and asset class values.`,
          type: "success",
        }),
        error: (error) => ({
          title: "Backfill failed",
          description:
            error instanceof Error
              ? error.message
              : "Something went wrong while backfilling the taxonomy.",
          type: "error",
        }),
      })

      if (result.updatedCount > 0) router.refresh()
    } catch {
      // The error toast above already surfaced this; nothing further to do.
    } finally {
      setIsBackfilling(false)
    }
  }

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Master Taxonomy Dictionary</CardTitle>
        <CardDescription>
          Reads Final_Master_Dictionary.csv from the project root and upserts
          it into the master taxonomy dictionary, matched on Part Number.
          Existing part numbers are updated in place; new ones are added. No
          file picker — the file must already be on the server. Once seeded,
          run the retroactive backfill to apply those canonical
          classifications to spares already on file.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleSeed} disabled={isSeeding} className="self-start">
            {isSeeding ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : null}
            {isSeeding ? "Seeding…" : "Seed Master Dictionary"}
          </Button>

          <Button
            onClick={handleBackfill}
            disabled={isBackfilling}
            variant="outline"
            className="self-start"
          >
            {isBackfilling ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : null}
            {isBackfilling ? "Backfilling…" : "Retroactive Taxonomy Backfill"}
          </Button>
        </div>

        {status ? (
          <Alert variant={status.ok ? "default" : "destructive"}>
            <AlertTitle>{status.ok ? "Seed complete" : "Seed failed"}</AlertTitle>
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
