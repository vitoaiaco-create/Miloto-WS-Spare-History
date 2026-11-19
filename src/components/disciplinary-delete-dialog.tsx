"use client"

import { useState } from "react"
import { Loader2Icon } from "lucide-react"

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
import type { DisciplinaryCase } from "@/lib/disciplinary-cases"

// Mount this only while a case is pending deletion; `onClose` unmounts it.
export function DeleteCaseDialog({
  caseItem,
  onConfirm,
  onClose,
}: {
  caseItem: DisciplinaryCase
  // Resolves true when the case was deleted.
  onConfirm: (caseItem: DisciplinaryCase) => Promise<boolean>
  onClose: () => void
}) {
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    setPending(true)
    const deleted = await onConfirm(caseItem)
    setPending(false)
    if (deleted) onClose()
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {caseItem.caseRef}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the case for{" "}
            {caseItem.driverName || "this driver"} and its signed documents
            from the tracker. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => void handleConfirm()}
          >
            {pending && <Loader2Icon className="animate-spin" />}
            Delete case
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
