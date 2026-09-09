"use client"

import { useState } from "react"

import Papa from "papaparse"
import * as XLSX from "xlsx"

import { ingestMileage, ingestSpares } from "@/actions/ingestion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"

export function DataUploader() {
  const [file, setFile] = useState<File | null>(null)
  const [dataType, setDataType] = useState<string>("spares")

  async function importParsedRows(parsedData: unknown[]) {
    try {
      const result =
        dataType === "spares"
          ? await ingestSpares(parsedData)
          : await ingestMileage(parsedData)

      toast.add({
        title: "Import successful",
        description: `Imported ${result.count} record${result.count === 1 ? "" : "s"}.`,
        type: "success",
      })
    } catch (error) {
      toast.add({
        title: "Import failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while importing the file.",
        type: "error",
      })
    }
  }

  async function handleFileUpload() {
    if (!file) return

    const fileName = file.name.toLowerCase()

    if (fileName.endsWith(".csv")) {
      Papa.parse(file, {
        header: true,
        complete: (results) => importParsedRows(results.data as unknown[]),
      })
    } else if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      const arrayBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer)
      const firstSheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[firstSheetName]
      const parsedData = XLSX.utils.sheet_to_json(worksheet)
      await importParsedRows(parsedData)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Select
        value={dataType}
        onValueChange={(value) => {
          if (value) setDataType(value)
        }}
      >
        <SelectTrigger className="w-[220px]">
          <SelectValue placeholder="Select data type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="spares">Spares Outward List</SelectItem>
          <SelectItem value="mileage">Daily Mileage Log</SelectItem>
        </SelectContent>
      </Select>

      <Input
        type="file"
        accept=".csv, .xlsx, .xls"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      <Button onClick={handleFileUpload}>Parse File</Button>
    </div>
  )
}
