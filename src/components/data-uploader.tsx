"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import Papa from "papaparse"
import * as XLSX from "xlsx"

import {
  commitSparesIngestion,
  ingestAssets,
  ingestMonthlyPairings,
  parseAndPreviewSpares,
  type IngestResult,
  type PreviewSparePart,
  type TaxonomyDictionaryOptions,
} from "@/actions/ingestion"
import {
  IngestResultDialog,
  buildIngestDialogResult,
  ingestErrorDialogResult,
  type IngestDialogResult,
} from "@/components/ingest-result-dialog"
import {
  PreIngestionReview,
  type ReviewedSpareMapping,
} from "@/components/pre-ingestion-review"
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
import {
  looksLikeMileageExport,
  looksLikeOilsExport,
} from "@/lib/spreadsheet"

const INGEST_ACTIONS = {
  assets: ingestAssets,
  pairings: ingestMonthlyPairings,
} as const

type DirectDataType = keyof typeof INGEST_ACTIONS
type DataType = DirectDataType | "spares"

const DATA_TYPE_LABELS: Record<DataType, string> = {
  assets: "Fleet Asset List",
  spares: "Job Cards Outward Report",
  pairings: "Asset Pairings",
}

type SparesPreviewState = {
  uniqueParts: PreviewSparePart[]
  dictionaryOptions: TaxonomyDictionaryOptions
  rawRows: unknown[]
  skipped: IngestResult["skipped"]
  validRowCount: number
}

// Rows sent per Server Action call. A Server Action body is capped at 1 MB by
// default and the mileage log runs to ~36k rows, so a file is uploaded in
// batches instead of one request.
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

export function DataUploader() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const [dataType, setDataType] = useState<DataType>("spares")
  const [isImporting, setIsImporting] = useState(false)
  const [isCommitting, setIsCommitting] = useState(false)
  const [sparesPreview, setSparesPreview] = useState<SparesPreviewState | null>(
    null
  )
  const [ingestResult, setIngestResult] = useState<IngestDialogResult | null>(
    null
  )

  function clearSparesPreview() {
    setSparesPreview(null)
  }

  async function previewSpares(rows: unknown[]) {
    const uniquePartsByKey = new Map<string, PreviewSparePart>()
    const skipped: IngestResult["skipped"] = []
    let validRowCount = 0
    let dictionaryOptions: TaxonomyDictionaryOptions = {
      tier1: [],
      tier2: [],
      tier3: [],
      assetClass: [],
    }

    for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
      const batch = rows.slice(start, start + IMPORT_BATCH_SIZE)
      const result = await parseAndPreviewSpares({
        rows: batch,
        firstRowNumber: start + 2,
      })

      validRowCount += result.validRowCount
      skipped.push(...result.skipped)
      dictionaryOptions = result.dictionaryOptions

      for (const part of result.uniqueParts) {
        const existing = uniquePartsByKey.get(part.partNumberKey)
        if (existing) {
          existing.occurrenceCount += part.occurrenceCount
          continue
        }
        uniquePartsByKey.set(part.partNumberKey, { ...part })
      }
    }

    const uniqueParts = [...uniquePartsByKey.values()].sort((a, b) => {
      if (a.isOrphan !== b.isOrphan) return a.isOrphan ? -1 : 1
      return a.partNumber.localeCompare(b.partNumber)
    })

    if (uniqueParts.length === 0) {
      setIngestResult(
        buildIngestDialogResult({
          imported: 0,
          duplicates: 0,
          skipped,
          createdAssets: [],
        })
      )
      clearSparesPreview()
      return
    }

    setSparesPreview({
      uniqueParts,
      dictionaryOptions,
      rawRows: rows,
      skipped,
      validRowCount,
    })
  }

  async function handleApproveAndIngest(mappings: ReviewedSpareMapping[]) {
    if (!sparesPreview || isCommitting) return

    setIsCommitting(true)

    try {
      let imported = 0
      let duplicates = 0
      let dictionaryUpserted = 0
      const skipped: IngestResult["skipped"] = []
      const createdAssets = new Set<string>()

      for (
        let start = 0;
        start < sparesPreview.rawRows.length;
        start += IMPORT_BATCH_SIZE
      ) {
        const batch = sparesPreview.rawRows.slice(
          start,
          start + IMPORT_BATCH_SIZE
        )
        const result = await commitSparesIngestion({
          // Mappings are sent with every batch so later chunks still get
          // the reviewed taxonomy. The dictionary upsert is idempotent.
          mappings,
          rows: batch,
          firstRowNumber: start + 2,
        })

        imported += result.imported
        duplicates += result.duplicates
        dictionaryUpserted = result.dictionaryUpserted
        skipped.push(...result.skipped)
        for (const fleetNumber of result.createdAssets) {
          createdAssets.add(fleetNumber)
        }
      }

      clearSparesPreview()
      setFile(null)
      setFileInputKey((key) => key + 1)

      toast.add({
        title: "Ingestion complete",
        description: [
          `Imported ${imported} record${imported === 1 ? "" : "s"}.`,
          duplicates > 0
            ? ` ${duplicates} already on file were left unchanged.`
            : "",
          ` Learned ${dictionaryUpserted} part${
            dictionaryUpserted === 1 ? "" : "s"
          } in the master dictionary.`,
          skipped.length > 0
            ? ` Skipped ${skipped.length} invalid source row${
                skipped.length === 1 ? "" : "s"
              }.`
            : "",
          createdAssets.size > 0
            ? ` Registered ${createdAssets.size} new asset${
                createdAssets.size === 1 ? "" : "s"
              }.`
            : "",
        ].join(""),
        type: "success",
      })

      router.refresh()
    } catch (error) {
      toast.add({
        title: "Ingestion failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong committing this upload.",
        type: "error",
      })
    } finally {
      setIsCommitting(false)
    }
  }

  async function importRows(rows: unknown[]) {
    if (dataType === "spares") return

    const ingest = INGEST_ACTIONS[dataType]

    let imported = 0
    let duplicates = 0
    let divertedToTriage = 0
    const skipped: IngestResult["skipped"] = []
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
      divertedToTriage += result.divertedToTriage ?? 0
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
        divertedToTriage,
      })
    )

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

      if (looksLikeMileageExport(rows)) {
        toast.add({
          title: "Use the Mileage tab",
          description:
            "This file has a Miloto_No column, so it is a mileage export. Switch to the Mileage tab and upload it there.",
          type: "error",
        })
        return
      }

      if (looksLikeOilsExport(rows)) {
        toast.add({
          title: "Use the Oils Ingestion tab",
          description:
            "This file looks like an oil consumption report. Switch to the Oils Ingestion tab and upload it there.",
          type: "error",
        })
        return
      }

      // Strips `Date` objects from Excel so the same payload can sit in
      // client state between preview and commit, and can cross the Server
      // Action boundary.
      const serializedRows = JSON.parse(JSON.stringify(rows)) as unknown[]

      if (dataType === "spares") {
        await previewSpares(serializedRows)
      } else {
        await importRows(serializedRows)
      }
    } catch (error) {
      setIngestResult(ingestErrorDialogResult(error))
    } finally {
      setIsImporting(false)
    }
  }

  const formBusy = isImporting || isCommitting
  const parseLabel =
    dataType === "spares"
      ? isImporting
        ? "Parsing…"
        : "Parse File"
      : isImporting
        ? "Importing…"
        : "Parse File"

  return (
    <div className="flex flex-col gap-6">
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Import Data</CardTitle>
          <CardDescription>
            Pick the fleet list, job cards report, or monthly asset pairings
            (trailer, truck, driver, and month) you are uploading, then choose
            a .csv, .xlsx or .xls file. Job cards are previewed first so you
            can review taxonomy mappings before they are written. Mileage
            logs belong on the Mileage tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[220px_minmax(0,1fr)_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="upload-data-type">Data Type</Label>
              <Select
                value={dataType}
                onValueChange={(value) => {
                  if (!value) return
                  setDataType(value as DataType)
                  clearSparesPreview()
                }}
                disabled={formBusy}
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
                key={fileInputKey}
                id="upload-file"
                type="file"
                accept=".csv, .xlsx, .xls"
                disabled={formBusy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  clearSparesPreview()
                }}
              />
            </div>

            <Button onClick={handleFileUpload} disabled={!file || formBusy}>
              {parseLabel}
            </Button>
          </div>
        </CardContent>
        <IngestResultDialog
          result={ingestResult}
          onClose={() => setIngestResult(null)}
        />
      </Card>

      {sparesPreview ? (
        <PreIngestionReview
          key={sparesPreview.uniqueParts
            .map((part) => part.partNumberKey)
            .join("|")}
          parts={sparesPreview.uniqueParts}
          dictionaryOptions={sparesPreview.dictionaryOptions}
          validRowCount={sparesPreview.validRowCount}
          skippedCount={sparesPreview.skipped.length}
          isCommitting={isCommitting}
          onApprove={handleApproveAndIngest}
          onDiscard={clearSparesPreview}
        />
      ) : null}
    </div>
  )
}
