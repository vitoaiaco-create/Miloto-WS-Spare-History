"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, TrashIcon } from "lucide-react"

import { deleteWorkshopEvent } from "@/actions/workshop-events"
import { ComplianceStatusBadge } from "@/components/compliance-status-badge"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
          <TableHead className="w-10 text-right">
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
              <TableCell>
                <div className="flex justify-end">
                  {event.canDelete ? (
                    <DeleteWorkshopEventDialog event={event} />
                  ) : (
                    // Same footprint as the icon-xs button so the actions
                    // column doesn't shift.
                    <span className="size-6" aria-hidden="true" />
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}

function DeleteWorkshopEventDialog({ event }: { event: WorkshopEventRow }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    setPending(true)
    try {
      // Wait for the server action to confirm before closing the dialog.
      await deleteWorkshopEvent(event.id)
      toast.add({
        title: "Event deleted",
        description: `${event.eventCategory} for ${event.assetName} was removed from the compliance logs.`,
        type: "success",
      })
      setOpen(false)
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
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next)
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete ${event.eventCategory} for ${event.assetName}`}
          />
        }
      >
        <TrashIcon />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Event?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove this record from the compliance logs
            and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          {/* A plain Button (not AlertDialogAction) so the dialog stays open
              until the async deletion has finished. */}
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void handleConfirm()}
          >
            {pending ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : null}
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
