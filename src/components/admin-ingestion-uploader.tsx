"use client"

import { useRef, useState, type DragEvent } from "react"
import { useRouter } from "next/navigation"
import Papa from "papaparse"
import { FileSpreadsheetIcon, Loader2Icon, UploadIcon } from "lucide-react"

import {
  uploadMonthlyPairings,
  uploadTyrePenalties,
  type AdminCsvRows,
  type AdminUploadResult,
} from "@/actions/admin-upload"
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
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

type UploaderKind = "tyre-penalties" | "monthly-pairings"

const UPLOADERS: Record<
  UploaderKind,
  {
    title: string
    description: string
    action: (rows: AdminCsvRows) => Promise<AdminUploadResult>
    noun: string
  }
> = {
  "tyre-penalties": {
    title: "Upload Tyre Penalties (Processed CSV)",
    description:
      "Columns: Visual Id, Scrap Date, Scrap Reason, Penalty Points, Asset ID. Rows with 0 penalty points are ignored. Asset ID must already exist on the fleet list (e.g. MT38).",
    action: uploadTyrePenalties,
    noun: "tyre penalty",
  },
  "monthly-pairings": {
    title: "Upload Monthly Asset Pairings (CSV)",
    description:
      "Columns: Active_Month, Truck, Driver, Trailer. Truck and Trailer must already exist on the fleet list (e.g. MTL99, MT38).",
    action: uploadMonthlyPairings,
    noun: "pairing",
  },
}

// Each Server Action call carries one batch, which keeps the request body
// well under the Server Action size limit for large Python exports.
const BATCH_SIZE = 500

const MAX_LISTED_UNMAPPED = 10

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm
}

function parseCsv(file: File) {
  return new Promise<AdminCsvRows>((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
      complete: (parsed) => {
        const fatal = parsed.errors.find(
          (error) => error.type === "Quotes" || error.type === "Delimiter"
        )

        if (fatal) {
          reject(
            new Error(
              fatal.row !== undefined
                ? `CSV could not be parsed at row ${fatal.row + 2}: ${fatal.message}`
                : `CSV could not be parsed: ${fatal.message}`
            )
          )
          return
        }

        resolve(parsed.data)
      },
      error: (error) => reject(error),
    })
  })
}

function mergeResults(total: AdminUploadResult, next: AdminUploadResult) {
  total.inserted += next.inserted
  total.duplicates += next.duplicates
  total.skippedUnmapped += next.skippedUnmapped
  total.skippedInvalid += next.skippedInvalid
  total.filteredZeroPoints += next.filteredZeroPoints
  total.mirroredToLogistics += next.mirroredToLogistics

  for (const asset of next.unmappedAssets) {
    if (!total.unmappedAssets.includes(asset)) total.unmappedAssets.push(asset)
  }

  for (const reason of next.invalidReasons) {
    if (!total.invalidReasons.includes(reason)) {
      total.invalidReasons.push(reason)
    }
  }
}

function describeResult(result: AdminUploadResult, noun: string) {
  const parts = [
    `Inserted ${result.inserted} ${plural(result.inserted, noun)}.`,
    `Skipped ${result.skippedUnmapped} ${plural(
      result.skippedUnmapped,
      "row"
    )} with unmapped assets${
      result.unmappedAssets.length > 0
        ? ` (${result.unmappedAssets.slice(0, MAX_LISTED_UNMAPPED).join(", ")}${
            result.unmappedAssets.length > MAX_LISTED_UNMAPPED
              ? `, +${result.unmappedAssets.length - MAX_LISTED_UNMAPPED} more`
              : ""
          })`
        : ""
    }.`,
  ]

  if (result.duplicates > 0) {
    parts.push(`${result.duplicates} already on file.`)
  }

  if (result.filteredZeroPoints > 0) {
    parts.push(`${result.filteredZeroPoints} zero-point rows ignored.`)
  }

  if (result.skippedInvalid > 0) {
    parts.push(
      `${result.skippedInvalid} invalid ${plural(
        result.skippedInvalid,
        "row"
      )} skipped (${result.invalidReasons.join("; ")}).`
    )
  }

  if (result.mirroredToLogistics > 0) {
    parts.push(
      `${result.mirroredToLogistics} synced to Logistics pairings.`
    )
  }

  return parts.join(" ")
}

export function AdminIngestionUploader({ kind }: { kind: UploaderKind }) {
  const { title, description, action, noun } = UPLOADERS[kind]
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const inputId = `admin-ingestion-${kind}`

  function selectFile(candidate: File | null | undefined) {
    if (!candidate) return

    if (!candidate.name.toLowerCase().endsWith(".csv")) {
      toast.add({
        title: "Unsupported file",
        description: "Choose a .csv file.",
        type: "error",
      })
      return
    }

    setFile(candidate)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDragging(false)
    if (isUploading) return
    selectFile(event.dataTransfer.files[0])
  }

  async function handleUpload() {
    if (!file) return

    setIsUploading(true)

    try {
      const rows = await parseCsv(file)

      if (rows.length === 0) {
        toast.add({
          title: "Nothing to upload",
          description: "The CSV has no data rows.",
          type: "error",
        })
        return
      }

      const total: AdminUploadResult = {
        inserted: 0,
        duplicates: 0,
        skippedUnmapped: 0,
        unmappedAssets: [],
        skippedInvalid: 0,
        invalidReasons: [],
        filteredZeroPoints: 0,
        mirroredToLogistics: 0,
      }

      for (let start = 0; start < rows.length; start += BATCH_SIZE) {
        mergeResults(total, await action(rows.slice(start, start + BATCH_SIZE)))
      }

      const hasProblems = total.skippedUnmapped > 0 || total.skippedInvalid > 0

      toast.add({
        title: hasProblems
          ? "Upload finished with skipped rows"
          : "Upload complete",
        description: describeResult(total, noun),
        type: hasProblems ? "warning" : "success",
        timeout: hasProblems ? 15000 : 8000,
      })

      setFile(null)
      if (inputRef.current) inputRef.current.value = ""
      router.refresh()
    } catch (error) {
      toast.add({
        title: "Upload failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while importing the file.",
        type: "error",
      })
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Label
          htmlFor={inputId}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors hover:bg-muted/50",
            isDragging && "border-ring bg-muted/50",
            isUploading && "pointer-events-none opacity-50"
          )}
        >
          <FileSpreadsheetIcon className="size-8 text-muted-foreground" />
          <span className="text-sm font-medium">
            {file ? file.name : "Drop a CSV here, or choose a file"}
          </span>
          {file ? (
            <span className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </span>
          ) : null}
        </Label>
        <Input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv"
          disabled={isUploading}
          onChange={(event) => selectFile(event.target.files?.[0])}
        />
        <Button
          type="button"
          className="self-start"
          disabled={!file || isUploading}
          onClick={handleUpload}
        >
          {isUploading ? (
            <Loader2Icon data-icon="inline-start" className="animate-spin" />
          ) : (
            <UploadIcon data-icon="inline-start" />
          )}
          {isUploading ? "Uploading…" : "Upload"}
        </Button>
      </CardContent>
    </Card>
  )
}
