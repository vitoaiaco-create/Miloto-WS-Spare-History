"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"

import { logWorkshopEvent } from "@/actions/workshop-events"
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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import {
  WORKSHOP_EVENT_CATEGORIES,
  WORKSHOP_EVENT_OUTCOMES,
  type WorkshopEventAssetOption,
  type WorkshopEventCategory,
} from "@/lib/workshop-events"

type AssetGroup = { value: string; items: string[] }

export function WorkshopEventForm({
  assets,
}: {
  assets: WorkshopEventAssetOption[]
}) {
  const router = useRouter()
  const [assetName, setAssetName] = useState<string | null>(null)
  const [eventCategory, setEventCategory] =
    useState<WorkshopEventCategory | null>(null)
  const [eventOutcome, setEventOutcome] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const outcomeOptions = eventCategory
    ? WORKSHOP_EVENT_OUTCOMES[eventCategory]
    : []

  function handleCategoryChange(category: WorkshopEventCategory) {
    setEventCategory(category)
    // Outcomes are category-specific, so a previous pick never carries over.
    // A category with a single outcome (Wheel Alignment) is preselected;
    // Air System Check always needs an explicit pass/fail choice.
    const options = WORKSHOP_EVENT_OUTCOMES[category]
    setEventOutcome(options.length === 1 ? options[0] : null)
  }

  const assetIdByName = useMemo(
    () => new Map(assets.map((asset) => [asset.assetName, asset.id])),
    [assets]
  )

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
    ].filter((group): group is AssetGroup => group !== null)
  }, [assets])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const assetId = assetName ? assetIdByName.get(assetName) : undefined
    if (assetId === undefined || !eventCategory || !eventOutcome) {
      toast.add({
        title: "Complete the form",
        description: "An asset, event category and outcome are required.",
        type: "error",
      })
      return
    }

    setIsSaving(true)
    try {
      await logWorkshopEvent(assetId, eventCategory, eventOutcome)
      toast.add({
        title: "Event logged",
        description: `${eventCategory} recorded for ${assetName}.`,
        type: "success",
      })
      setAssetName(null)
      setEventCategory(null)
      setEventOutcome(null)
      router.refresh()
    } catch (error) {
      toast.add({
        title: "Could not log event",
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
    <form
      onSubmit={handleSubmit}
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] lg:items-end"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="workshop-event-asset">Asset</Label>
        <Combobox
          items={assetGroups}
          value={assetName}
          onValueChange={(value) => setAssetName(value ?? null)}
        >
          <ComboboxInput
            id="workshop-event-asset"
            placeholder="Type to search (e.g. MT27)"
            showClear
            className="w-full"
          />
          <ComboboxContent>
            <ComboboxEmpty>No asset found.</ComboboxEmpty>
            <ComboboxList>
              {(group: AssetGroup) => (
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
        <Label htmlFor="workshop-event-category">Event category</Label>
        <Select
          value={eventCategory}
          onValueChange={(value) => {
            if (
              value &&
              (WORKSHOP_EVENT_CATEGORIES as readonly string[]).includes(value)
            ) {
              handleCategoryChange(value as WorkshopEventCategory)
            }
          }}
        >
          <SelectTrigger id="workshop-event-category" className="w-full">
            <SelectValue placeholder="Select event category" />
          </SelectTrigger>
          <SelectContent>
            {WORKSHOP_EVENT_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="workshop-event-outcome">Outcome</Label>
        <Select
          value={eventOutcome}
          disabled={!eventCategory}
          onValueChange={(value) => {
            if (value && outcomeOptions.includes(value)) {
              setEventOutcome(value)
            }
          }}
        >
          <SelectTrigger id="workshop-event-outcome" className="w-full">
            <SelectValue
              placeholder={
                eventCategory ? "Select outcome" : "Choose a category first"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {outcomeOptions.map((outcome) => (
              <SelectItem key={outcome} value={outcome}>
                {outcome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        type="submit"
        disabled={isSaving || !assetName || !eventCategory || !eventOutcome}
      >
        {isSaving ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : null}
        Log event
      </Button>
    </form>
  )
}
