"use client"

import { useRef, useState } from "react"
import { Loader2Icon, Share2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import type {
  SparesHistoryFilters,
  SparesHistoryRow,
} from "@/lib/spares-history"

// Converts the `YYYY-MM-DD` string returned for `date()` columns into the
// `DD-MM-YYYY` display format used throughout this table. Duplicated from
// `spares-table.tsx` rather than shared, since the export layout below is
// deliberately independent of the on-screen table's markup/styling.
function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-")
  return `${day}-${month}-${year}`
}

function formatUsd(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`
}

function formatRunningKm(runningKm: number | null) {
  return runningKm === null ? "—" : runningKm.toLocaleString()
}

// The exported image can land in front of people with no Miloto account
// (suppliers, drivers, etc. over WhatsApp), so it needs to read as a
// standalone document — this line bakes the active filters into the image
// itself rather than relying on page context the recipient can't see.
function describeFilters(filters: SparesHistoryFilters) {
  const parts: string[] = []
  if (filters.fleetNo) parts.push(`Fleet No: ${filters.fleetNo}`)
  if (filters.partNumber) parts.push(`Part Number: ${filters.partNumber}`)
  if (filters.materialName) parts.push(`Material: ${filters.materialName}`)
  if (filters.subEquipment)
    parts.push(`Sub Equipment: ${filters.subEquipment}`)
  if (filters.startDate || filters.endDate) {
    parts.push(
      `Date Range: ${filters.startDate ? formatDate(filters.startDate) : "…"} to ${
        filters.endDate ? formatDate(filters.endDate) : "…"
      }`
    )
  }
  return parts.join("   •   ")
}

// Width (px) the off-screen export layout is rendered at before capture.
// Fixed rather than responsive, so the resulting image looks the same
// regardless of the screen it was shared from.
const EXPORT_WIDTH_PX = 1000

// WhatsApp and other chat apps cap attachment size/dimensions, and a
// multi-thousand-row table would make for a huge, slow-to-render image
// anyway — so the shared snapshot is capped and the caption says so.
const MAX_EXPORT_ROWS = 250

export function ShareTableButton({
  spares,
  filters,
}: {
  spares: SparesHistoryRow[]
  filters: SparesHistoryFilters
}) {
  const exportRef = useRef<HTMLDivElement>(null)
  const [isSharing, setIsSharing] = useState(false)

  const exportRows = spares.slice(0, MAX_EXPORT_ROWS)
  const truncatedCount = spares.length - exportRows.length

  async function handleShare() {
    if (isSharing || !exportRef.current) return

    setIsSharing(true)

    try {
      // Loaded dynamically so the (fairly large) canvas-rendering library
      // only ships to the client when someone actually shares, rather than
      // bloating the initial page bundle.
      const { default: html2canvas } = await import("html2canvas-pro")

      const canvas = await html2canvas(exportRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
      })

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png")
      )
      if (!blob) throw new Error("Could not generate an image of the table.")

      const fileName = `spares-history-${new Date().toISOString().slice(0, 10)}.png`
      const file = new File([blob], fileName, { type: "image/png" })

      // `navigator.share`/`canShare` are unavailable in some browsers and
      // don't support files in others — feature-detect both before relying
      // on the native share sheet.
      if (
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: "Spares History",
          text: "Spares history export from Miloto WS Spare History.",
        })
        return
      }

      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)

      toast.add({
        title: "Image downloaded",
        description:
          "Your browser doesn't support sharing files directly, so the image was downloaded instead — attach it to WhatsApp manually.",
        type: "info",
      })
    } catch (error) {
      // The user closing the native share sheet without picking an app
      // throws an AbortError — that's a cancellation, not a real failure.
      if (error instanceof DOMException && error.name === "AbortError") return

      toast.add({
        title: "Share failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while preparing the image.",
        type: "error",
      })
    } finally {
      setIsSharing(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={spares.length === 0 || isSharing}
        onClick={handleShare}
      >
        {isSharing ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          <Share2Icon data-icon="inline-start" />
        )}
        {isSharing ? "Preparing…" : "Share"}
      </Button>

      {/* Off-screen export layout captured by html2canvas-pro above. Placed
          off-screen (not `hidden`/`display:none`, which would stop it from
          rendering at all) and styled independently of the page's
          light/dark theme, so the exported image looks the same no matter
          which theme the sharer has active. */}
      <div
        className="fixed top-0 left-0 -z-50 overflow-hidden opacity-0"
        aria-hidden="true"
      >
        <div
          ref={exportRef}
          style={{ width: EXPORT_WIDTH_PX }}
          className="flex flex-col gap-4 bg-white p-8 font-sans text-black"
        >
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">Spares History</h1>
            {describeFilters(filters) && (
              <p className="text-sm text-zinc-600">
                {describeFilters(filters)}
              </p>
            )}
            <p className="text-xs text-zinc-500">
              Generated {new Date().toLocaleString()} · Miloto WS Spare
              History
              {truncatedCount > 0
                ? ` · Showing first ${exportRows.length} of ${spares.length} rows`
                : ""}
            </p>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-zinc-300 text-left">
                <th className="p-2">Outward Date</th>
                <th className="p-2">Material Name</th>
                <th className="p-2">Identity No</th>
                <th className="p-2">Part Number</th>
                <th className="p-2">Sub Equipment</th>
                <th className="p-2">Qty</th>
                <th className="p-2">Price ($)</th>
                <th className="p-2">Amount ($)</th>
                <th className="p-2">Running KM</th>
              </tr>
            </thead>
            <tbody>
              {exportRows.map((spare) => (
                <tr key={spare.id} className="border-b border-zinc-200">
                  <td className="p-2">{formatDate(spare.fitmentDate)}</td>
                  <td className="p-2">{spare.materialName}</td>
                  <td className="p-2">{spare.identityNo}</td>
                  <td className="p-2">{spare.partNumber}</td>
                  <td className="p-2">{spare.subEquipment}</td>
                  <td className="p-2">{spare.quantity}</td>
                  <td className="p-2">{formatUsd(spare.priceUsd)}</td>
                  <td className="p-2">{formatUsd(spare.amountUsd)}</td>
                  <td className="p-2">{formatRunningKm(spare.runningKm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
