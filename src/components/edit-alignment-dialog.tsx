"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, Pencil } from "lucide-react"

import { updateAlignmentDetails } from "@/actions/spares-statement"
import {
  EMPTY_OUT_OF_SQUARE_VALUES,
  metricToFieldValue,
  OutOfSquareFields,
  type OutOfSquareFieldValues,
} from "@/components/out-of-square-fields"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  collectOutOfSquareMetrics,
  formatStatementDate,
  type OutOfSquareAxleKey,
  type OutOfSquareMetrics,
  type StatementAssetType,
} from "@/lib/spares-statement"

function valuesFromMetrics(metrics: OutOfSquareMetrics): OutOfSquareFieldValues {
  return {
    outOfSquareAxle1: metricToFieldValue(metrics.outOfSquareAxle1),
    outOfSquareAxle2: metricToFieldValue(metrics.outOfSquareAxle2),
    outOfSquareAxle3: metricToFieldValue(metrics.outOfSquareAxle3),
  }
}

export function EditAlignmentDialog({
  eventId,
  assetName,
  assetType,
  date,
  outOfSquareAxle1,
  outOfSquareAxle2,
  outOfSquareAxle3,
}: {
  eventId: number
  assetName: string
  assetType: StatementAssetType
  date: string
  outOfSquareAxle1?: number | null
  outOfSquareAxle2?: number | null
  outOfSquareAxle3?: number | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<OutOfSquareFieldValues>(
    EMPTY_OUT_OF_SQUARE_VALUES
  )
  const [isSaving, setIsSaving] = useState(false)

  function handleFieldChange(key: OutOfSquareAxleKey, value: string) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsed = collectOutOfSquareMetrics(assetType, values)
    if (!parsed.ok) {
      toast.add({
        title: "Check out-of-square values",
        description: parsed.message,
        type: "error",
      })
      return
    }

    setIsSaving(true)
    try {
      await updateAlignmentDetails(eventId, parsed.data)
      toast.add({
        title: "Alignment details saved",
        description: `Out of Square values for ${assetName} on ${formatStatementDate(date)} have been updated.`,
        type: "success",
      })
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast.add({
        title: "Could not save alignment details",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while saving the alignment.",
        type: "error",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setValues(
            valuesFromMetrics({
              outOfSquareAxle1,
              outOfSquareAxle2,
              outOfSquareAxle3,
            })
          )
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Edit Alignment"
              onClick={() => setOpen(true)}
            />
          }
        >
          <Pencil />
        </TooltipTrigger>
        <TooltipContent>Edit Alignment</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Alignment</DialogTitle>
          <DialogDescription>
            Update Out of Square readings for {assetName} on{" "}
            {formatStatementDate(date)}. Values are stored in mm/m.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <OutOfSquareFields
            assetType={assetType}
            values={values}
            onChange={handleFieldChange}
            idPrefix={`edit-alignment-${eventId}`}
          />
          <DialogFooter>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : null}
              Save alignment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
