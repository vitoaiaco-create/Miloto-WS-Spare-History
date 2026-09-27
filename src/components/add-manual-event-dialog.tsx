"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, PlusIcon } from "lucide-react"

import { createManualStatementEvent } from "@/actions/spares-statement"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox"
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  formatStatementDate,
  MANUAL_EVENT_LABELS,
  MANUAL_EVENT_MATERIAL_NAMES,
  MANUAL_STATEMENT_EVENT_TYPES,
  type ManualStatementEventType,
  type StatementAssetOption,
} from "@/lib/spares-statement"

export function AddManualEventDialog({
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
  const [eventType, setEventType] =
    useState<ManualStatementEventType>("WHEEL_ALIGNMENT")
  const [notes, setNotes] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const assetGroups = useMemo(() => {
    const trucks: string[] = []
    const trailers: string[] = []

    for (const asset of assets) {
      if (asset.assetType === "Truck") trucks.push(asset.assetName)
      else trailers.push(asset.assetName)
    }

    return [
      trucks.length > 0 ? { value: "Trucks", items: trucks } : null,
      trailers.length > 0 ? { value: "Trailers", items: trailers } : null,
    ].filter((group): group is { value: string; items: string[] } =>
      group !== null
    )
  }, [assets])

  function resetForm() {
    setAssetName(defaultAssetName)
    setDate(defaultDate)
    setEventType("WHEEL_ALIGNMENT")
    setNotes("")
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!assetName || !date) {
      toast.add({
        title: "Choose an asset and date",
        description: "A fleet unit and event date are required.",
        type: "error",
      })
      return
    }

    setIsSaving(true)
    try {
      const result = await createManualStatementEvent({
        assetName,
        date,
        eventType,
        notes,
      })
      toast.add({
        title: "Manual event added",
        description: `${MANUAL_EVENT_MATERIAL_NAMES[result.eventType]} for ${result.assetName} on ${formatStatementDate(result.date)} will appear on statements covering that date.`,
        type: "success",
      })
      setOpen(false)
      resetForm()
      router.refresh()
    } catch (error) {
      toast.add({
        title: "Could not add manual event",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while saving the event.",
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
          setEventType("WHEEL_ALIGNMENT")
          setNotes("")
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            size="icon-lg"
            className="fixed right-6 bottom-6 z-40 size-14 rounded-full shadow-lg"
            aria-label="Add manual event"
          />
        }
      >
        <PlusIcon className="size-6" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Manual Event</DialogTitle>
          <DialogDescription>
            Inject a wheel alignment, a completed routine check, or a
            checks-pending note into the executive statement. It sorts by
            date alongside physical spare replacements, including on assets
            with no spare issues.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="manual-event-asset">Asset ID</Label>
            <Combobox
              items={assetGroups}
              value={assetName || null}
              onValueChange={(value) => setAssetName(value ?? "")}
            >
              <ComboboxInput
                id="manual-event-asset"
                placeholder="Type to search (e.g. MT27)"
                showClear
                className="w-full"
              />
              <ComboboxContent className="z-[60]">
                <ComboboxEmpty>No asset found.</ComboboxEmpty>
                <ComboboxList>
                  {(group: { value: string; items: string[] }) => (
                    <ComboboxGroup key={group.value} items={group.items}>
                      <ComboboxLabel>{group.value}</ComboboxLabel>
                      <ComboboxCollection>
                        {(item: string) => (
                          <ComboboxItem key={item} value={item}>
                            {item}
                          </ComboboxItem>
                        )}
                      </ComboboxCollection>
                    </ComboboxGroup>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="manual-event-type">Event Type</Label>
            <Select
              value={eventType}
              onValueChange={(value) => {
                if (
                  value &&
                  (MANUAL_STATEMENT_EVENT_TYPES as readonly string[]).includes(
                    value
                  )
                ) {
                  setEventType(value as ManualStatementEventType)
                }
              }}
            >
              <SelectTrigger id="manual-event-type" className="w-full">
                <SelectValue placeholder="Select event type" />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_STATEMENT_EVENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {MANUAL_EVENT_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="manual-event-date">Date</Label>
            <Input
              id="manual-event-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="manual-event-notes">Notes</Label>
            <Textarea
              id="manual-event-notes"
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
              Save event
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
