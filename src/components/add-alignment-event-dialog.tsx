"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, PlusIcon } from "lucide-react"

import { createManualAlignmentEvent } from "@/actions/spares-statement"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  formatStatementDate,
  type StatementAssetOption,
} from "@/lib/spares-statement"

export function AddAlignmentEventDialog({
  assets,
  defaultAssetName,
  defaultDate,
}: {
  assets: StatementAssetOption[]
  defaultAssetName: string
  defaultDate: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [assetName, setAssetName] = useState(defaultAssetName)
  const [date, setDate] = useState(defaultDate)
  const [notes, setNotes] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const truckAssets = useMemo(
    () => assets.filter((asset) => asset.assetType === "Truck"),
    [assets]
  )
  const trailerAssets = useMemo(
    () => assets.filter((asset) => asset.assetType === "Trailer"),
    [assets]
  )

  function resetForm() {
    setAssetName(defaultAssetName)
    setDate(defaultDate)
    setNotes("")
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!assetName || !date) {
      toast.add({
        title: "Choose an asset and date",
        description: "A fleet unit and alignment date are required.",
        type: "error",
      })
      return
    }

    setIsSaving(true)
    try {
      const result = await createManualAlignmentEvent({
        assetName,
        date,
        notes,
      })
      toast.add({
        title: "Alignment event added",
        description: `WHEEL ALIGNMENT for ${result.assetName} on ${formatStatementDate(result.date)} will appear on statements covering that date.`,
        type: "success",
      })
      setOpen(false)
      resetForm()
      router.refresh()
    } catch (error) {
      toast.add({
        title: "Could not add alignment event",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while saving the alignment event.",
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
          setAssetName(defaultAssetName)
          setDate(defaultDate)
          setNotes("")
        }
      }}
    >
      <DialogTrigger render={<Button type="button" />}>
        <PlusIcon data-icon="inline-start" />
        Add Alignment Event
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Alignment Event</DialogTitle>
          <DialogDescription>
            Inject a wheel alignment into the executive statement. It sorts by
            date alongside physical spare replacements.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="alignment-asset">Asset ID</Label>
            <Select
              value={assetName || undefined}
              onValueChange={(value) => {
                if (value) setAssetName(value)
              }}
            >
              <SelectTrigger id="alignment-asset" className="w-full">
                <SelectValue placeholder="Select asset" />
              </SelectTrigger>
              <SelectContent>
                {truckAssets.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>Trucks</SelectLabel>
                    {truckAssets.map((asset) => (
                      <SelectItem key={asset.assetName} value={asset.assetName}>
                        {asset.assetName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {trailerAssets.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>Trailers</SelectLabel>
                    {trailerAssets.map((asset) => (
                      <SelectItem key={asset.assetName} value={asset.assetName}>
                        {asset.assetName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="alignment-date">Date</Label>
            <Input
              id="alignment-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="alignment-notes">Notes</Label>
            <Textarea
              id="alignment-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional"
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isSaving || !assetName || !date}>
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
