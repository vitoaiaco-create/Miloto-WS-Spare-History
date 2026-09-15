"use client"

import { useState } from "react"

import { requestOilSample } from "@/actions/ingestion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "@/components/ui/toast"
import {
  CRITICAL_BURN_RATE,
  oilComplianceStatusLabel,
  type OilComplianceEvent,
  type OilComplianceStatus,
  type OilHealthRow,
} from "@/lib/oil-status"

function formatBurnRate(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
}

function statusVariant(status: OilComplianceStatus) {
  if (status === "overdue") return "destructive" as const
  if (status === "due_soon") return "outline" as const
  return "secondary" as const
}

function statusClassName(status: OilComplianceStatus) {
  if (status === "due_soon") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
  }
  if (status === "compliant") {
    return "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
  }
  return undefined
}

function lastEventLabel(lastEvent: OilComplianceEvent) {
  return lastEvent === "sample" ? "Sample" : "Service"
}

function needsSampleRequest(status: OilComplianceStatus | null) {
  return status === "overdue" || status === "due_soon"
}

function kmSinceComplianceTooltip(kmSinceCompliance: number | null) {
  if (kmSinceCompliance === null) return "No compliance mileage on file"

  return `${kmSinceCompliance.toLocaleString("en-US")} km since last compliance`
}

export function OilHealthTable({ rows }: { rows: OilHealthRow[] }) {
  const [pendingAssetId, setPendingAssetId] = useState<number | null>(null)

  async function onRequestSample(row: OilHealthRow) {
    setPendingAssetId(row.assetId)

    try {
      const result = await requestOilSample({ assetId: row.assetId })

      toast.add({
        title: "Sample requested",
        description: `${result.fleetNumber} is now in the sampling pipeline.`,
        type: "success",
      })
    } catch (error) {
      toast.add({
        title: "Could not request sample",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while requesting the oil sample.",
        type: "error",
      })
    } finally {
      setPendingAssetId(null)
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Asset ID</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Last Event</TableHead>
          <TableHead className="text-right">Burn Rate (L/1000km)</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={5}
              className="text-center text-muted-foreground"
            >
              No active Miloto assets found.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.assetId}>
              <TableCell>{row.assetName}</TableCell>
              <TableCell>
                {row.status ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Badge
                          variant={statusVariant(row.status)}
                          className={statusClassName(row.status)}
                        />
                      }
                    >
                      {oilComplianceStatusLabel(row.status)}
                    </TooltipTrigger>
                    <TooltipContent>
                      {kmSinceComplianceTooltip(row.kmSinceCompliance)}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                {row.lastEvent ? lastEventLabel(row.lastEvent) : "—"}
              </TableCell>
              <TableCell className="text-right">
                {row.burnRate !== null &&
                row.burnRate >= CRITICAL_BURN_RATE ? (
                  <Badge variant="destructive" className="font-bold tabular-nums">
                    {formatBurnRate(row.burnRate)}
                  </Badge>
                ) : (
                  <span className="tabular-nums">
                    {formatBurnRate(row.burnRate)}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {needsSampleRequest(row.status) ? (
                  <Button
                    size="sm"
                    variant={
                      row.status === "overdue" ? "destructive" : "default"
                    }
                    disabled={pendingAssetId === row.assetId}
                    onClick={() => onRequestSample(row)}
                  >
                    {pendingAssetId === row.assetId
                      ? "Requesting…"
                      : "Request Sample"}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
