"use client"

import type { RefObject } from "react"
import {
  CameraIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"
import {
  copyElementToClipboard,
  downloadElementAsPng,
  exportDataToCSV,
} from "@/lib/export-image"
import { cn } from "@/lib/utils"

export function ExportMenu({
  targetRef,
  filename = "export.png",
  tableData,
  className,
}: {
  targetRef?: RefObject<HTMLElement | null>
  filename?: string
  tableData?: Record<string, unknown>[]
  className?: string
}) {
  if (!targetRef && !tableData) {
    return null
  }

  function getTarget() {
    const element = targetRef?.current
    if (!element) {
      toast.add({
        title: "Export failed",
        description: "Could not find the element to export.",
        type: "error",
      })
      return null
    }
    return element
  }

  async function handleCopy() {
    const element = getTarget()
    if (!element) return

    try {
      await copyElementToClipboard(element)
    } catch (error) {
      toast.add({
        title: "Copy failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while copying the image.",
        type: "error",
      })
    }
  }

  async function handleDownload() {
    const element = getTarget()
    if (!element) return

    try {
      await downloadElementAsPng(element, filename)
    } catch (error) {
      toast.add({
        title: "Download failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while downloading the image.",
        type: "error",
      })
    }
  }

  function handleCsv() {
    if (!tableData || tableData.length === 0) {
      toast.add({
        title: "Export failed",
        description: "No table data to export.",
        type: "error",
      })
      return
    }

    try {
      exportDataToCSV(tableData, filename)
    } catch (error) {
      toast.add({
        title: "CSV export failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while generating the CSV.",
        type: "error",
      })
    }
  }

  return (
    <div className={cn(className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="bg-background/80 text-muted-foreground shadow-xs backdrop-blur-sm"
              aria-label="Export"
            />
          }
        >
          {targetRef ? <CameraIcon /> : <DownloadIcon />}
          <span className="sr-only">Export</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {targetRef ? (
            <>
              <DropdownMenuItem onClick={handleCopy}>
                <ClipboardCopyIcon data-icon="inline-start" />
                Copy to Clipboard
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownload}>
                <DownloadIcon data-icon="inline-start" />
                Download PNG
              </DropdownMenuItem>
            </>
          ) : null}
          {tableData ? (
            <DropdownMenuItem onClick={handleCsv}>
              <FileSpreadsheetIcon data-icon="inline-start" />
              Download as CSV
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
