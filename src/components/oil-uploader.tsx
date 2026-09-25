"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import Papa from "papaparse"
import * as XLSX from "xlsx"

import { ingestOils, type IngestResult } from "@/actions/ingestion"
import {
  IngestResultDialog,
  buildIngestDialogResult,
  ingestErrorDialogResult,
  type IngestDialogResult,
} from "@/components/ingest-result-dialog"
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
import { looksLikeMileageExport } from "@/lib/spreadsheet"

// Rows sent per Server Action call. A Server Action body is capped at 1 MB by
// default, so a file is uploaded in batches instead of one request — see the
// matching constant in `src/components/data-uploader.tsx`.
const IMPORT_BATCH_SIZE = 500

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
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
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

// Dedicated uploader for oil consumption reports (fleet number, date,
// quantity, job card), mirroring `src/components/mileage-uploader.tsx`.
export function OilUploader() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [ingestResult, setIngestResult] = useState<IngestDialogResult | null>(
    null
  )

  async function importRows(rows: unknown[]) {
    let imported = 0
    let duplicates = 0
    const skipped: IngestResult["skipped"] = []
    const createdAssets = new Set<string>()

    for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
      const batch = rows.slice(start, start + IMPORT_BATCH_SIZE)

      const result: IngestResult = await ingestOils({
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

    setIngestResult(
      buildIngestDialogResult({
        imported,
        duplicates,
        skipped,
        createdAssets: [...createdAssets],
      })
    )

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

      if (looksLikeMileageExport(rows)) {
        toast.add({
          title: "Use the Mileage tab",
          description:
            "This file has a Miloto_No and Metric column, so it is a mileage export. Switch to the Mileage tab and upload it there.",
          type: "error",
        })
        return
      }

      await importRows(rows)
    } catch (error) {
      setIngestResult(ingestErrorDialogResult(error))
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Import Oils</CardTitle>
        <CardDescription>
          Upload the oil consumption export from the ERP (Identity No, Outward
          Date, Quantity, Job Card No) as a .csv, .xlsx or .xls file. Extra
          columns such as Material Name or Part Number are ignored. Rows
          already on file for the same asset, job card and date are left
          unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="upload-oils-file">File</Label>
            <Input
              id="upload-oils-file"
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
      <IngestResultDialog
        result={ingestResult}
        onClose={() => setIngestResult(null)}
      />
    </Card>
  )
}
