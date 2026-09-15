"use client"

import { useState } from "react"

import { OilSampleForm } from "@/components/oil-sample-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
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
  const [sampleAsset, setSampleAsset] = useState<OilHealthRow | null>(null)

  return (
    <>
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
                <TableCell className="text-right tabular-nums">
                  {formatBurnRate(row.burnRate)}
                </TableCell>
                <TableCell className="text-right">
                  {needsSampleRequest(row.status) ? (
                    <Button
                      size="sm"
                      variant={
                        row.status === "overdue" ? "destructive" : "default"
                      }
                      onClick={() => setSampleAsset(row)}
                    >
                      Request Sample
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog
        open={sampleAsset !== null}
        onOpenChange={(open) => {
          if (!open) setSampleAsset(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Oil Sample</DialogTitle>
            <DialogDescription>
              Log a lab sample for {sampleAsset?.assetName}. Enter the truck
              odometer at draw time to reset the compliance clock.
            </DialogDescription>
          </DialogHeader>
          {sampleAsset ? (
            <OilSampleForm
              key={sampleAsset.assetId}
              defaultAssetId={sampleAsset.assetName}
              mode="request"
              onSuccess={() => setSampleAsset(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
