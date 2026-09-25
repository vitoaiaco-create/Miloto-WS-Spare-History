"use client"

import { useState } from "react"
import { useFormStatus } from "react-dom"
import { useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"

import { uploadTirePenalties } from "@/actions/ingestion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type UploadStatus = {
  ok: boolean
  message: string
}

function TirePenaltyFormFields() {
  const { pending } = useFormStatus()

  return (
    <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="upload-tire-penalties-file">File</Label>
        <Input
          id="upload-tire-penalties-file"
          accept=".csv"
          name="file"
          type="file"
          disabled={pending}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : null}
        {pending ? "Uploading…" : "Upload Penalties"}
      </Button>
    </div>
  )
}

export function TirePenaltyUploader() {
  const router = useRouter()
  const [status, setStatus] = useState<UploadStatus | null>(null)

  async function handleSubmit(formData: FormData) {
    const file = formData.get("file")

    if (!(file instanceof File) || file.size === 0) {
      setStatus({ ok: false, message: "Choose a CSV file to upload." })
      return
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setStatus({ ok: false, message: "Choose a .csv file." })
      return
    }

    setStatus(null)

    try {
      const result = await uploadTirePenalties({
        csvText: await file.text(),
      })

      const skippedNote =
        result.skipped.length > 0
          ? ` ${result.skipped.length} row${
              result.skipped.length === 1 ? " was" : "s were"
            } skipped.`
          : ""
      const duplicateNote =
        result.duplicates > 0
          ? ` ${result.duplicates} record${
              result.duplicates === 1 ? " was" : "s were"
            } already on file.`
          : ""

      setStatus({
        ok: result.imported > 0 || result.duplicates > 0,
        message: `Imported ${result.imported} penalty record${
          result.imported === 1 ? "" : "s"
        }.${duplicateNote}${skippedNote}`,
      })

      router.refresh()
    } catch (error) {
      setStatus({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Something went wrong while importing the file.",
      })
    }
  }

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Tire Scrap Penalties</CardTitle>
        <CardDescription>
          Upload the processed tire-scrapping penalties CSV (Visual Id, Scrap
          Date, Scrap Reason, Penalty Points, Asset ID). Rows with 0 penalty
          points are ignored. Asset ID must already exist on the fleet list
          (for example MT33).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form action={handleSubmit}>
          <TirePenaltyFormFields />
        </form>

        {status ? (
          <Alert variant={status.ok ? "default" : "destructive"}>
            <AlertTitle>{status.ok ? "Success" : "Upload failed"}</AlertTitle>
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
