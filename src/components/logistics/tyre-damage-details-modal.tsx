"use client"

import { useEffect, useMemo, useState } from "react"
import { CopyIcon, Loader2Icon, MessageCircleIcon } from "lucide-react"

import {
  getTyreDamageIncidentDetails,
  type TyreDamageIncidentDetail,
  type TyreDamageIncidentDetailsResult,
} from "@/actions/logistics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

// `YYYY-MM-DD` -> `12 Mar 2026`, without going through `Date` so the
// calendar day never shifts with the viewer's timezone.
function formatIncidentDate(iso: string) {
  const [year, month, day] = iso.split("-")
  const monthName = MONTH_NAMES[Number(month) - 1]
  if (!year || !monthName || !day) return iso
  return `${Number(day)} ${monthName} ${year}`
}

function driverLabel(incident: TyreDamageIncidentDetail) {
  return incident.drivers.length > 0
    ? incident.drivers.join(", ")
    : "No driver paired"
}

export function formatTyreDamageWhatsAppMessage({
  title,
  year,
  incidents,
}: {
  title: string
  year: number
  incidents: TyreDamageIncidentDetail[]
}) {
  const lines = [
    `*MILOTO TYRE DAMAGES — ${title} (${year})*`,
    `Total Operational Damages: ${incidents.length}`,
    "",
  ]

  for (const incident of incidents) {
    const parts = [
      `*${formatIncidentDate(incident.date)}*`,
      incident.assetId === title ? null : incident.assetId,
      incident.reason,
      `Driver: ${driverLabel(incident)}`,
    ].filter((part): part is string => Boolean(part))
    lines.push(`• ${parts.join(" — ")}`)
  }

  return lines.join("\n")
}

type LoadedState = {
  key: string
  result: TyreDamageIncidentDetailsResult
}

export function TyreDamageDetailsModal({
  open,
  onOpenChange,
  year,
  assetId,
  driverName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  year: number
  /** Canonical fleet number of the clicked bar, e.g. `MTL106`. */
  assetId?: string | null
  driverName?: string | null
}) {
  const [loaded, setLoaded] = useState<LoadedState | null>(null)

  const requestKey = open
    ? `${year}|${assetId ?? ""}|${driverName ?? ""}`
    : null

  useEffect(() => {
    if (!requestKey) return

    let cancelled = false
    getTyreDamageIncidentDetails({
      year,
      assetId: assetId ?? undefined,
      driverName: driverName ?? undefined,
    })
      .then((result) => {
        if (!cancelled) setLoaded({ key: requestKey, result })
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({
            key: requestKey,
            result: {
              success: false,
              error: "Could not load tyre damage incidents.",
            },
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [requestKey, year, assetId, driverName])

  // Stale results from a previously opened bar count as "still loading".
  const result = loaded && loaded.key === requestKey ? loaded.result : null
  const isLoading = open && result === null
  const incidents = useMemo(
    () => (result?.success ? result.data : []),
    [result]
  )

  const title = assetId ?? driverName ?? "Fleet"

  const assignedDrivers = useMemo(
    () =>
      [...new Set(incidents.flatMap((incident) => incident.drivers))].sort(
        (a, b) => a.localeCompare(b)
      ),
    [incidents]
  )
  const pairedAssets = useMemo(
    () =>
      [...new Set(incidents.flatMap((incident) => incident.pairedAssets))].sort(
        (a, b) => a.localeCompare(b)
      ),
    [incidents]
  )

  const message = useMemo(
    () => formatTyreDamageWhatsAppMessage({ title, year, incidents }),
    [title, year, incidents]
  )
  const canShare = !isLoading && incidents.length > 0

  function shareOnWhatsApp() {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer"
    )
  }

  async function copyForWhatsApp() {
    try {
      await navigator.clipboard.writeText(message)
      toast.add({
        title: "Copied for WhatsApp",
        description: "Paste the tyre damage summary into any WhatsApp chat.",
        type: "success",
      })
    } catch {
      toast.add({
        title: "Could not copy to clipboard",
        description: "Your browser blocked clipboard access.",
        type: "error",
      })
    }
  }

  const shareButtons = (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={copyForWhatsApp}
        disabled={!canShare}
      >
        <CopyIcon />
        Copy for WhatsApp
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={shareOnWhatsApp}
        disabled={!canShare}
      >
        <MessageCircleIcon />
        Share on WhatsApp
      </Button>
    </>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>
            Tyre Damages — {title} ({year})
          </DialogTitle>
          <DialogDescription>
            Total operational tyre damages:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {isLoading ? "…" : incidents.length}
            </span>
          </DialogDescription>
          {!isLoading && incidents.length > 0 ? (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>
                Assigned driver(s):{" "}
                <span className="text-foreground">
                  {assignedDrivers.length > 0
                    ? assignedDrivers.join(", ")
                    : "None paired"}
                </span>
              </span>
              {pairedAssets.length > 0 ? (
                <span>
                  Paired with:{" "}
                  <span className="text-foreground">
                    {pairedAssets.join(", ")}
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Loading incidents…
            </div>
          ) : result && !result.success ? (
            <p className="py-12 text-center text-sm text-destructive">
              {result.error}
            </p>
          ) : incidents.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No operational tyre damages found.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Damage details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.map((incident) => (
                  <TableRow key={incident.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatIncidentDate(incident.date)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant="secondary">{incident.assetId}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {incident.assetType}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {driverLabel(incident)}
                      {incident.pairedAssets.length > 0 ? (
                        <span className="block text-xs text-muted-foreground">
                          with {incident.pairedAssets.join(", ")}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {incident.reason}
                      <span className="block text-xs text-muted-foreground">
                        Ref {incident.visualId} · {incident.penaltyPoints} pts
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>{shareButtons}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
