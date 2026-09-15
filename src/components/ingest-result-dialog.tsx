"use client"

import type { SkippedRow } from "@/actions/ingestion"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// How many created fleet numbers / rejected rows the dialog names before it
// summarizes the rest.
const MAX_LISTED_ASSETS = 8
const MAX_LISTED_SKIPPED_ROWS = 3

export type IngestDialogResult = {
  variant: "success" | "error"
  description: string
}

function describeCreatedAssets(createdAssets: string[]) {
  if (createdAssets.length === 0) return ""

  const listed = createdAssets.slice(0, MAX_LISTED_ASSETS).join(", ")
  const unlisted = createdAssets.length - MAX_LISTED_ASSETS

  return ` Registered ${createdAssets.length} new asset${
    createdAssets.length === 1 ? "" : "s"
  }: ${listed}${unlisted > 0 ? `, and ${unlisted} more` : ""}.`
}

function describeSkippedRows(skipped: SkippedRow[]) {
  if (skipped.length === 0) return ""

  const listed = skipped
    .slice(0, MAX_LISTED_SKIPPED_ROWS)
    .map(({ rowNumber, error }) => `row ${rowNumber} — ${error}`)
    .join("; ")
  const unlisted = skipped.length - MAX_LISTED_SKIPPED_ROWS

  return ` Skipped ${skipped.length} row${
    skipped.length === 1 ? "" : "s"
  }: ${listed}${unlisted > 0 ? `; and ${unlisted} more` : ""}.`
}

// Turns the aggregated ingest counts into the Success / Error copy shown in
// the confirmation modal after `ingestSpares` / `ingestMileage` finish.
export function buildIngestDialogResult(input: {
  imported: number
  duplicates: number
  skipped: SkippedRow[]
  createdAssets: string[]
}): IngestDialogResult {
  const description = [
    `Imported ${input.imported} record${input.imported === 1 ? "" : "s"}.`,
    input.duplicates > 0
      ? ` ${input.duplicates} record${
          input.duplicates === 1 ? " was" : "s were"
        } already on file and left unchanged.`
      : "",
    describeCreatedAssets(input.createdAssets),
    describeSkippedRows(input.skipped),
  ].join("")

  // Nothing written and nothing already on file means the whole batch was
  // rejected, which is a failure rather than a no-op.
  const isFailure = input.imported === 0 && input.duplicates === 0

  return {
    variant: isFailure ? "error" : "success",
    description,
  }
}

export function ingestErrorDialogResult(error: unknown): IngestDialogResult {
  return {
    variant: "error",
    description:
      error instanceof Error
        ? error.message
        : "Something went wrong while importing the file.",
  }
}

export function IngestResultDialog({
  result,
  onClose,
}: {
  result: IngestDialogResult | null
  onClose: () => void
}) {
  const isError = result?.variant === "error"

  return (
    <AlertDialog
      open={result !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={isError ? "text-destructive" : undefined}>
            {isError ? "Error" : "Success"}
          </AlertDialogTitle>
          <AlertDialogDescription>{result?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
