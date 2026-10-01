"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, UploadIcon } from "lucide-react"

import { ingestAlignments } from "@/actions/ingestion"
import {
  buildIngestDialogResult,
  ingestErrorDialogResult,
  IngestResultDialog,
  type IngestDialogResult,
} from "@/components/ingest-result-dialog"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

// Admin-only bulk importer for the Executive Spare Statement's wheel
// alignment events (`manualAlignmentEventsTable`, written to by
// `ingestAlignments` in src/actions/ingestion.ts). Styled like the other
// bulk importers' file controls (see `tire-penalty-uploader.tsx`), but
// condensed into a single file-input button for the Spares History
// toolbar: picking a file uploads it immediately rather than requiring a
// separate "Parse"/"Upload" step, since this importer has no data-type
// picker to pair it with.
export function AlignmentsUploadButton({
  size = "default",
}: {
  size?: "default" | "sm"
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [ingestResult, setIngestResult] = useState<IngestDialogResult | null>(
    null
  )

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    // Reset so selecting the same file again still fires onChange.
    event.target.value = ""
    if (!file) return

    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.add({
        title: "Unsupported file",
        description: "Choose a .csv file.",
        type: "error",
      })
      return
    }

    setIsUploading(true)
    try {
      const result = await ingestAlignments({ csvText: await file.text() })
      setIngestResult(buildIngestDialogResult(result))
      router.refresh()
    } catch (error) {
      setIngestResult(ingestErrorDialogResult(error))
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        disabled={isUploading}
        onChange={handleFileSelected}
      />
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
      >
        {isUploading ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          <UploadIcon data-icon="inline-start" />
        )}
        {isUploading ? "Uploading…" : "Upload Alignments CSV"}
      </Button>
      <IngestResultDialog
        result={ingestResult}
        onClose={() => setIngestResult(null)}
      />
    </>
  )
}
