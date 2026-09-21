import { toBlob, toPng } from "html-to-image"

import { toast } from "@/components/ui/toast"

export async function copyElementToClipboard(element: HTMLElement) {
  const blob = await toBlob(element, { backgroundColor: "#ffffff" })
  if (!blob) {
    throw new Error("Could not generate an image of the element.")
  }

  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])

  toast.add({
    title: "Image copied to clipboard",
    type: "success",
  })
}

export async function downloadElementAsPng(
  element: HTMLElement,
  filename: string
) {
  const dataUrl = await toPng(element, { backgroundColor: "#ffffff" })
  const link = document.createElement("a")
  link.href = dataUrl
  link.download = filename
  link.click()
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return ""
  const str =
    typeof value === "object" ? JSON.stringify(value) : String(value)
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

export function exportDataToCSV<T>(data: T[], filename: string) {
  const first = data[0]
  if (!first || typeof first !== "object") {
    throw new Error("No data to export.")
  }

  const headers = Object.keys(first)
  const rows = data.map((row) => {
    const record = row as Record<string, unknown>
    return headers.map((key) => csvCell(record[key])).join(",")
  })
  const csvContent = [headers.join(","), ...rows].join("\n")

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
