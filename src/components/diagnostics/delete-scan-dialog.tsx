"use client"

import { format } from "date-fns"
import { Loader2Icon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { deletePttSession } from "@/actions/ptt-diagnostics"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { normalizeFleetId } from "@/lib/ptt-diagnostics"

export type DeletableScan = {
  id: number
  fleetId: string
  scannedAt: Date
}

/**
 * Confirmation dialog for permanently deleting a PTT scan. Calls
 * `deletePttSession` (removes the Blob screenshots, the session row and, by
 * cascade, its faults / attachments), shows a toast and then reports the
 * deleted id through `onDeleted` so the workspace can sync its state.
 */
export function DeleteScanDialog({
  scan,
  onOpenChange,
  onDeleted,
}: {
  /** The scan awaiting confirmation. `null` keeps the dialog closed. */
  scan: DeletableScan | null
  onOpenChange: (open: boolean) => void
  onDeleted: (sessionId: number) => void
}) {
  const [isDeleting, setIsDeleting] = useState(false)

  // Keep the last scan rendered while the close animation runs.
  const [shown, setShown] = useState<DeletableScan | null>(scan)
  if (scan && scan !== shown) setShown(scan)

  async function handleDelete() {
    if (!scan) return
    setIsDeleting(true)
    try {
      const result = await deletePttSession(scan.id)
      const fleetId = normalizeFleetId(scan.fleetId)
      if (!result.success) {
        toast.add({
          title: "Could not delete scan",
          description: result.error,
          type: "error",
        })
        return
      }
      toast.add({
        title: "Scan deleted",
        description: `The ${fleetId} scan and its archived PTT screenshots were removed.`,
        type: "success",
      })
      onOpenChange(false)
      onDeleted(scan.id)
    } catch {
      toast.add({
        title: "Could not delete scan",
        description: "Something went wrong. Please try again.",
        type: "error",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <AlertDialog
      open={scan !== null}
      onOpenChange={(open) => {
        if (!isDeleting) onOpenChange(open)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this scan?</AlertDialogTitle>
          <AlertDialogDescription>
            {shown ? (
              <>
                This permanently deletes the{" "}
                <strong>{normalizeFleetId(shown.fleetId)}</strong> scan from{" "}
                <strong>{format(shown.scannedAt, "dd MMM yyyy, HH:mm")}</strong>
                , including its fault codes, directive and the archived PTT
                screenshots. This cannot be undone.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          {/* Not an AlertDialogAction: that closes the dialog before the
              delete has finished (and can fail). */}
          <Button
            type="button"
            variant="destructive"
            disabled={isDeleting}
            onClick={() => void handleDelete()}
          >
            {isDeleting ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <Trash2Icon data-icon="inline-start" />
            )}
            Delete Scan
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
