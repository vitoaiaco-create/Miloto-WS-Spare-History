"use client"

import { useRef, useState, type DragEvent } from "react"
import { useRouter } from "next/navigation"
import * as XLSX from "xlsx"
import { FileSpreadsheetIcon, Loader2Icon } from "lucide-react"

import {
  uploadBulkAlignments,
  type BulkAlignmentRow,
  type BulkAlignmentUploadResult,
} from "@/actions/admin-upload"
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
import {
  indexRowByHeader,
  normalizeSpreadsheetHeader,
  parseSpreadsheetDate,
  toNumber,
  toTrimmedString,
} from "@/lib/spreadsheet"
import { cn } from "@/lib/utils"
import { workshopDayStart } from "@/lib/workshop-events"

// Sheet and column names are spelled exactly as in the workshop's workbook
// (including the "Alingment" typo and the trailing space after "DATE ").
// Lookups are trim/case-insensitive so a stray space can't break an import.
type SheetSpec = {
  sheetName: string
  columns: { axle1?: string; axle2: string; axle3: string }
}

const SHEETS: SheetSpec[] = [
  {
    sheetName: "MTL Alignment",
    columns: { axle2: "OS 2nd AXEL", axle3: "OS 3rd AXEL" },
  },
  {
    sheetName: "MT Alingment",
    columns: {
      axle1: "OS 1st AXEL",
      axle2: "OS 2nd AXEL",
      axle3: "OS 3rd AXEL",
    },
  },
]

const DATE_COLUMN = "DATE "
const IDENTITY_COLUMN = "Identity No"

// Each Server Action call carries one batch to stay well under the request
// body limit for large workbooks.
const BATCH_SIZE = 500

const MS_PER_HOUR = 3_600_000

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return count === 1 ? singular : pluralForm
}

// Reduces a date cell to the workshop calendar day it shows in Excel and
// returns that day's start in Africa/Lusaka, so the server sees the same
// day the user sees regardless of the browser's time zone.
function toWorkshopDate(value: unknown): Date | null {
  let day: string

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null

    // `cellDates` yields local-midnight dates that can land a few seconds
    // before midnight (historical zone offsets); reading local components
    // at +12h pins the intended day.
    const noon = new Date(value.getTime() + 12 * MS_PER_HOUR)
    day = [
      noon.getFullYear(),
      String(noon.getMonth() + 1).padStart(2, "0"),
      String(noon.getDate()).padStart(2, "0"),
    ].join("-")
  } else {
    // Text / serial-number cells: parsed in UTC by the shared helper.
    const parsed = parseSpreadsheetDate(value)
    if (!parsed) return null
    day = parsed.toISOString().slice(0, 10)
  }

  return workshopDayStart(day)
}

// Blank / non-numeric cells are "not measured", never 0.
function toAxle(value: unknown) {
  const parsed = toNumber(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true })

  const sheetByName = new Map(
    workbook.SheetNames.map((name) => [normalizeSpreadsheetHeader(name), name])
  )

  const rows: BulkAlignmentRow[] = []
  const missingSheets: string[] = []
  let ignoredRows = 0

  for (const spec of SHEETS) {
    const actualName = sheetByName.get(
      normalizeSpreadsheetHeader(spec.sheetName)
    )

    if (!actualName) {
      missingSheets.push(spec.sheetName)
      continue
    }

    const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[actualName],
      { defval: null }
    )

    for (const sheetRow of sheetRows) {
      const cells = indexRowByHeader(sheetRow)
      const assetName = toTrimmedString(
        cells.get(normalizeSpreadsheetHeader(IDENTITY_COLUMN))
      )
      const date = toWorkshopDate(
        cells.get(normalizeSpreadsheetHeader(DATE_COLUMN))
      )

      // Blank spacer rows and rows missing an Identity No or Date.
      if (!assetName || !date) {
        ignoredRows += 1
        continue
      }

      const { axle1, axle2, axle3 } = spec.columns

      rows.push({
        assetName,
        date,
        axle1: axle1
          ? toAxle(cells.get(normalizeSpreadsheetHeader(axle1)))
          : undefined,
        axle2: toAxle(cells.get(normalizeSpreadsheetHeader(axle2))),
        axle3: toAxle(cells.get(normalizeSpreadsheetHeader(axle3))),
      })
    }
  }

  return { rows, missingSheets, ignoredRows }
}

export function BulkAlignmentsUploader() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  // Dropping (or choosing) a file reads and uploads it immediately.
  function selectFile(candidate: File | null | undefined) {
    if (!candidate || isUploading) return

    if (!/\.xlsx?$/i.test(candidate.name)) {
      toast.add({
        title: "Unsupported file",
        description: "Choose an Excel file (.xlsx or .xls).",
        type: "error",
      })
      return
    }

    setFile(candidate)
    void handleUpload(candidate)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setIsDragging(false)
    if (isUploading) return
    selectFile(event.dataTransfer.files[0])
  }

  async function handleUpload(source: File) {
    setIsUploading(true)

    try {
      const { rows, missingSheets, ignoredRows } = parseWorkbook(
        await source.arrayBuffer()
      )

      if (missingSheets.length === SHEETS.length) {
        toast.add({
          title: "Sheets not found",
          description: `Expected sheets: ${SHEETS.map(
            ({ sheetName }) => `"${sheetName}"`
          ).join(" and ")}.`,
          type: "error",
        })
        return
      }

      if (rows.length === 0) {
        toast.add({
          title: "Nothing to upload",
          description:
            "No rows with both an Identity No and a Date were found.",
          type: "error",
        })
        return
      }

      const total: BulkAlignmentUploadResult = {
        inserted: 0,
        duplicatesSkipped: 0,
        unmappedSkipped: 0,
        invalidSkipped: 0,
        unmappedAssets: [],
      }

      // Sequential on purpose: later batches see earlier inserts, which keeps
      // the duplicate check exact across batches.
      for (let start = 0; start < rows.length; start += BATCH_SIZE) {
        const next = await uploadBulkAlignments(
          rows.slice(start, start + BATCH_SIZE)
        )

        total.inserted += next.inserted
        total.duplicatesSkipped += next.duplicatesSkipped
        total.unmappedSkipped += next.unmappedSkipped
        total.invalidSkipped += next.invalidSkipped

        for (const asset of next.unmappedAssets) {
          if (!total.unmappedAssets.includes(asset)) {
            total.unmappedAssets.push(asset)
          }
        }
      }

      const parts = [
        `Uploaded ${total.inserted} ${plural(total.inserted, "alignment")}.`,
        `Skipped ${total.duplicatesSkipped} ${plural(
          total.duplicatesSkipped,
          "duplicate"
        )}.`,
      ]

      if (total.unmappedSkipped > 0) {
        parts.push(
          `${total.unmappedSkipped} ${plural(
            total.unmappedSkipped,
            "row"
          )} had an unknown Identity No (${total.unmappedAssets
            .slice(0, 10)
            .join(", ")}${total.unmappedAssets.length > 10 ? ", …" : ""}).`
        )
      }

      if (total.invalidSkipped > 0) {
        parts.push(
          `${total.invalidSkipped} invalid ${plural(
            total.invalidSkipped,
            "row"
          )} skipped.`
        )
      }

      if (ignoredRows > 0) {
        parts.push(
          `${ignoredRows} ${plural(
            ignoredRows,
            "row"
          )} without an Identity No or Date ignored.`
        )
      }

      if (missingSheets.length > 0) {
        parts.push(`Sheet not found: ${missingSheets.join(", ")}.`)
      }

      const hasProblems =
        total.unmappedSkipped > 0 ||
        total.invalidSkipped > 0 ||
        missingSheets.length > 0

      toast.add({
        title: hasProblems ? "Upload finished with skipped rows" : "Success",
        description: parts.join(" "),
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
        <CardTitle>Bulk Upload Wheel Alignments (Excel)</CardTitle>
        <CardDescription>
          Reads the &quot;MTL Alignment&quot; and &quot;MT Alingment&quot;
          sheets (columns: DATE, Identity No, OS 1st/2nd/3rd AXEL). Identity No
          must already exist on the fleet list. An alignment already on file
          for the same asset and day is skipped, so re-uploading is safe.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Label
          htmlFor="bulk-alignments-file"
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
            {file ? file.name : "Drop an Excel file here, or choose a file"}
          </span>
          {file ? (
            <span className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </span>
          ) : null}
        </Label>
        <Input
          ref={inputRef}
          id="bulk-alignments-file"
          type="file"
          accept=".xlsx,.xls"
          disabled={isUploading}
          onChange={(event) => selectFile(event.target.files?.[0])}
        />
        {isUploading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Uploading…
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
