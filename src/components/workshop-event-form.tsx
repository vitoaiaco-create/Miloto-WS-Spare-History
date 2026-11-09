"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { CalendarIcon, Loader2Icon } from "lucide-react"

import { logWorkshopEvent } from "@/actions/workshop-events"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import {
  buildWheelAlignmentOutcome,
  formatWorkshopDate,
  getAlignmentAxles,
  isAlignmentAxleOutOfSpec,
  toWorkshopDay,
  WORKSHOP_EVENT_CATEGORIES,
  WORKSHOP_EVENT_OUTCOMES,
  WORKSHOP_TIME_ZONE,
  workshopDayStart,
  type AlignmentAxleNumber,
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
  // The event date is held as a workshop calendar day (`YYYY-MM-DD`,
  // Africa/Lusaka), so it never shifts with the browser's time zone.
  const [eventDay, setEventDay] = useState(() => toWorkshopDay())
  const [isDateOpen, setIsDateOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const today = workshopDayStart(toWorkshopDay())
  const selectedDate = workshopDayStart(eventDay) ?? today ?? undefined

  const outcomeOptions = eventCategory
    ? WORKSHOP_EVENT_OUTCOMES[eventCategory]
    : []

  // Wheel alignments record out-of-square readings (mm/m, decimals and
  // negatives allowed). Prime movers (MTL) have Axle 2 and 3; trailers
  // (other MT) have Axle 1, 2 and 3. Held as strings so partially typed
  // values like "-" or "3." never fight the input.
  const isAlignment = eventCategory === "Wheel Alignment"
  const alignmentAxles = isAlignment ? getAlignmentAxles(assetName) : []
  const [axleInputs, setAxleInputs] = useState<Record<1 | 2 | 3, string>>({
    1: "",
    2: "",
    3: "",
  })

  function readAxle(axle: AlignmentAxleNumber) {
    const raw = axleInputs[axle].trim()
    if (!alignmentAxles.includes(axle) || raw === "") return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
  }

  const alignmentStatus = isAlignment
    ? buildWheelAlignmentOutcome({
        axle1: readAxle(1),
        axle2: readAxle(2),
        axle3: readAxle(3),
      }).status
    : null

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
    const eventDate = workshopDayStart(eventDay)
    if (
      assetId === undefined ||
      !eventCategory ||
      !eventOutcome ||
      !eventDate
    ) {
      toast.add({
        title: "Complete the form",
        description:
          "An asset, event category, outcome and event date are required.",
        type: "error",
      })
      return
    }

    // Anything typed in an axle box that isn't a valid number is rejected
    // rather than silently dropped.
    const invalidAxle = alignmentAxles.find((axle) => {
      const raw = axleInputs[axle].trim()
      return raw !== "" && !Number.isFinite(Number(raw))
    })
    if (invalidAxle !== undefined) {
      toast.add({
        title: "Check the measurements",
        description: `Axle ${invalidAxle} must be a number (e.g. -2.5 or 4.0).`,
        type: "error",
      })
      return
    }

    setIsSaving(true)
    try {
      await logWorkshopEvent(
        assetId,
        eventCategory,
        eventOutcome,
        eventDate,
        readAxle(1),
        readAxle(2),
        readAxle(3)
      )
      toast.add({
        title: "Event logged",
        description: `${eventCategory} recorded for ${assetName}.`,
        type: "success",
      })
      setAssetName(null)
      setEventCategory(null)
      setEventOutcome(null)
      setAxleInputs({ 1: "", 2: "", 3: "" })
      // Back to today so a backdated entry never leaks into the next one.
      setEventDay(toWorkshopDay())
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
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] lg:items-end"
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
        {isAlignment ? (
          // The alignment outcome is derived from the readings below (any
          // axle at or beyond +/-3 mm/m fails), so it is shown, not picked.
          <Input
            id="workshop-event-outcome"
            readOnly
            value={`${alignmentStatus} (auto)`}
            className={
              alignmentStatus === "FAILED"
                ? "font-medium text-destructive"
                : undefined
            }
          />
        ) : (
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
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="workshop-event-date">Event date</Label>
        <Popover open={isDateOpen} onOpenChange={setIsDateOpen}>
          <PopoverTrigger
            render={
              <Button
                id="workshop-event-date"
                type="button"
                variant="outline"
                className="w-full justify-start text-left font-normal"
              />
            }
          >
            <CalendarIcon data-icon="inline-start" />
            {selectedDate ? formatWorkshopDate(selectedDate) : "Pick a date"}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              timeZone={WORKSHOP_TIME_ZONE}
              selected={selectedDate}
              defaultMonth={selectedDate}
              // No future dates: everything after today (Lusaka) is disabled.
              disabled={today ? { after: today } : undefined}
              onSelect={(date) => {
                // Deselecting (clicking the chosen day again) is ignored; an
                // event always has a date.
                if (!date) return
                setEventDay(toWorkshopDay(date))
                setIsDateOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      {isAlignment && assetName ? (
        <fieldset className="grid gap-3 rounded-lg border p-3 sm:col-span-2 lg:col-span-full">
          <legend className="px-1 text-sm font-medium">
            Out of Square (mm/m)
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {alignmentAxles.map((axle) => {
              const raw = axleInputs[axle].trim()
              const value = raw === "" ? NaN : Number(raw)
              const outOfSpec =
                Number.isFinite(value) && isAlignmentAxleOutOfSpec(value)

              return (
                <div key={axle} className="grid gap-1.5">
                  <Label htmlFor={`workshop-event-axle-${axle}`}>
                    Axle {axle}
                  </Label>
                  <Input
                    id={`workshop-event-axle-${axle}`}
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    placeholder="e.g. -2.5"
                    value={axleInputs[axle]}
                    aria-invalid={outOfSpec}
                    onChange={(event) =>
                      setAxleInputs((current) => ({
                        ...current,
                        [axle]: event.target.value,
                      }))
                    }
                  />
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Any axle at +3 or above, or -3 or below, fails the alignment.
          </p>
        </fieldset>
      ) : null}

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
