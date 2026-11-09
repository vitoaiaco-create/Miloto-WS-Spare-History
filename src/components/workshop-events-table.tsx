"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, Trash2Icon } from "lucide-react"

import { deleteWorkshopEvent } from "@/actions/workshop-events"
import { ComplianceStatusBadge } from "@/components/compliance-status-badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  formatWorkshopDate,
  formatWorkshopTime,
  getComplianceStatus,
  type WorkshopEventRow,
} from "@/lib/workshop-events"

export function WorkshopEventsTable({ events }: { events: WorkshopEventRow[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<number | null>(null)

  async function handleDelete(event: WorkshopEventRow) {
    setPendingId(event.id)
    try {
      await deleteWorkshopEvent(event.id)
      toast.add({
        title: "Event removed",
        description: `${event.eventCategory} for ${event.assetName} was deleted.`,
        type: "success",
      })
      router.refresh()
    } catch (error) {
      toast.add({
        title: "Could not delete event",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while deleting the event.",
        type: "error",
      })
    } finally {
      setPendingId(null)
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Time</TableHead>
          <TableHead>Event date</TableHead>
          <TableHead>Asset</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Logged by</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell
              colSpan={8}
              className="h-24 text-center whitespace-normal text-muted-foreground"
            >
              No events logged today.
            </TableCell>
          </TableRow>
        ) : (
          events.map((event) => (
            <TableRow key={event.id}>
              <TableCell className="tabular-nums">
                {formatWorkshopTime(event.createdAt)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatWorkshopDate(event.eventDate)}
              </TableCell>
              <TableCell className="font-medium">{event.assetName}</TableCell>
              <TableCell>{event.assetType ?? "—"}</TableCell>
              <TableCell>{event.eventCategory}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <ComplianceStatusBadge
                    status={getComplianceStatus(
                      event.createdAt,
                      event.eventOutcome
                    )}
                  />
                  <span className="text-xs text-muted-foreground">
                    {event.eventOutcome}
                  </span>
                </div>
              </TableCell>
              <TableCell>{event.createdByName}</TableCell>
              <TableCell className="text-right">
                {event.canDelete ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pendingId !== null}
                    onClick={() => handleDelete(event)}
                    aria-label={`Delete ${event.eventCategory} for ${event.assetName}`}
                  >
                    {pendingId === event.id ? (
                      <Loader2Icon
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <Trash2Icon data-icon="inline-start" />
                    )}
                    Delete
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
