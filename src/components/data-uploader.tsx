"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import Papa from "papaparse"
import * as XLSX from "xlsx"

import {
  ingestAssets,
  ingestMileage,
  ingestSpares,
  type IngestResult,
  type SkippedRow,
} from "@/actions/ingestion"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"

const INGEST_ACTIONS = {
  assets: ingestAssets,
  spares: ingestSpares,
  mileage: ingestMileage,
} as const

type DataType = keyof typeof INGEST_ACTIONS

const DATA_TYPE_LABELS: Record<DataType, string> = {
  assets: "Fleet Asset List",
  spares: "Job Cards Outward Report",
  mileage: "Daily Mileage Log",
}

// Rows sent per Server Action call. A Server Action body is capped at 1 MB by
// default and the mileage log runs to ~36k rows, so a file is uploaded in
// batches instead of one request.
const IMPORT_BATCH_SIZE = 500

// How many created fleet numbers / rejected rows a toast names before it
// summarizes the rest.
const MAX_LISTED_ASSETS = 8
const MAX_LISTED_SKIPPED_ROWS = 3

// Excel and Papa Parse both emit a trailing all-empty row for a file that
// ends in a blank line; importing it would fail validation on every column.
function isPopulatedRow(row: unknown) {
  return (
    !!row &&
    typeof row === "object" &&
    Object.values(row).some((value) => String(value ?? "").trim() !== "")
  )
}

function parseCsv(file: File) {
  return new Promise<unknown[]>((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (error) => reject(error),
    })
  })
}

async function parseWorkbook(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer())
  const worksheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json(worksheet) as unknown[]
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

export function DataUploader() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [dataType, setDataType] = useState<DataType>("spares")
  const [isImporting, setIsImporting] = useState(false)

  async function importRows(rows: unknown[]) {
    const ingest = INGEST_ACTIONS[dataType]

    let imported = 0
    let duplicates = 0
    const skipped: SkippedRow[] = []
    const createdAssets = new Set<string>()

    for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
      const batch = rows.slice(start, start + IMPORT_BATCH_SIZE)

      const result: IngestResult = await ingest({
        // Strips the values that can't cross the Server Action boundary —
        // `xlsx` hands back `Date` objects for real date cells.
        rows: JSON.parse(JSON.stringify(batch)),
        // Row 1 of the sheet is the header, so the first data row is row 2.
        firstRowNumber: start + 2,
      })

      imported += result.imported
      duplicates += result.duplicates
      skipped.push(...result.skipped)
      for (const fleetNumber of result.createdAssets) {
        createdAssets.add(fleetNumber)
      }
    }

    const description = [
      `Imported ${imported} record${imported === 1 ? "" : "s"}.`,
      duplicates > 0
        ? ` ${duplicates} record${
            duplicates === 1 ? " was" : "s were"
          } already on file and left unchanged.`
        : "",
      describeCreatedAssets([...createdAssets]),
      describeSkippedRows(skipped),
    ].join("")

    // Nothing written and nothing already on file means the whole batch was
    // rejected, which is a failure rather than a no-op.
    const isFailure = imported === 0 && duplicates === 0

    toast.add({
      title: isFailure
        ? "Nothing imported"
        : skipped.length > 0
          ? "Imported with skipped rows"
          : "Import successful",
      description,
      type: isFailure ? "error" : skipped.length > 0 ? "warning" : "success",
    })

    // The table is rendered by a Server Component, so it only picks up the
    // new rows once the route re-renders.
    router.refresh()
  }

  async function handleFileUpload() {
    if (!file || isImporting) return

    const fileName = file.name.toLowerCase()
    const isCsv = fileName.endsWith(".csv")
    const isWorkbook = fileName.endsWith(".xlsx") || fileName.endsWith(".xls")

    if (!isCsv && !isWorkbook) {
      toast.add({
        title: "Unsupported file",
        description: "Choose a .csv, .xlsx or .xls file.",
        type: "error",
      })
      return
    }

    setIsImporting(true)

    try {
      const parsedRows = isCsv ? await parseCsv(file) : await parseWorkbook(file)
      const rows = parsedRows.filter(isPopulatedRow)

      if (rows.length === 0) {
        toast.add({
          title: "Nothing to import",
          description: "The file did not contain any rows.",
          type: "error",
        })
        return
      }

      await importRows(rows)
    } catch (error) {
      toast.add({
        title: "Import failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while importing the file.",
        type: "error",
      })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import Data</CardTitle>
        <CardDescription>
          Pick the report you are uploading, choose a .csv, .xlsx or .xls
          file, then parse it into the database.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[220px_minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="upload-data-type">Data Type</Label>
            <Select
              value={dataType}
              onValueChange={(value) => {
                if (value) setDataType(value as DataType)
              }}
              disabled={isImporting}
            >
              <SelectTrigger id="upload-data-type" className="w-full">
                <SelectValue placeholder="Select data type" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DATA_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="upload-file">File</Label>
            <Input
              id="upload-file"
              type="file"
              accept=".csv, .xlsx, .xls"
              disabled={isImporting}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <Button onClick={handleFileUpload} disabled={!file || isImporting}>
            {isImporting ? "Importing…" : "Parse File"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
