"use client"

import { format } from "date-fns"
import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

import { DatePickerWithRange } from "@/components/date-picker-with-range"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatIsoDate, parseIsoDate } from "@/lib/iso-date"
import type { SparesHistoryFilters } from "@/lib/spares-history"

type ExcludeDateRange = { from: Date; to: Date }

const SUB_EQUIPMENT_OPTIONS = [
  "Air System",
  "Aircon",
  "Axles",
  "Body",
  "Cabin",
  "Chassis",
  "Compressor",
  "Diffs",
  "Electrical",
  "Engine",
  "Hydraulic System",
  "Overhauled Diff",
  "Overhauled Engine",
  "Overhauled Volvo Engine",
  "Service",
  "Suspension",
  "Transmission",
]

type Filters = {
  fleetNo: string
  partNumber: string
  materialName: string
  startDate: string
  endDate: string
}

const EMPTY_FILTERS: Filters = {
  fleetNo: "",
  partNumber: "",
  materialName: "",
  startDate: "",
  endDate: "",
}

// Debounce (ms) before free-text filter changes push a new URL, so the
// server-rendered table doesn't re-fetch on every keystroke.
const FILTER_DEBOUNCE_MS = 300

function excludeRangeFromFilters(
  filters: SparesHistoryFilters
): ExcludeDateRange | undefined {
  const from = parseIsoDate(filters.excludeFrom)
  const to = parseIsoDate(filters.excludeTo)
  if (!from || !to) return undefined
  return from <= to ? { from, to } : { from: to, to: from }
}

function buildQueryString(
  filters: Filters,
  categories: string[],
  excludeDates: ExcludeDateRange | undefined
) {
  const params = new URLSearchParams()
  if (filters.fleetNo) params.set("fleetNo", filters.fleetNo)
  if (filters.partNumber) params.set("partNumber", filters.partNumber)
  if (filters.materialName) params.set("materialName", filters.materialName)
  for (const category of categories) {
    if (category) params.append("subEquipment", category)
  }
  if (filters.startDate) params.set("startDate", filters.startDate)
  if (filters.endDate) params.set("endDate", filters.endDate)
  if (excludeDates) {
    params.set("excludeFrom", formatIsoDate(excludeDates.from))
    params.set("excludeTo", formatIsoDate(excludeDates.to))
  }
  return params.toString()
}

export function SparesFilterBar({
  initialFilters,
}: {
  initialFilters: SparesHistoryFilters
}) {
  const router = useRouter()
  const pathname = usePathname()

  const [categories, setCategories] = useState<string[]>(
    initialFilters.subEquipment ?? []
  )
  const [excludeDates, setExcludeDates] = useState<
    { from: Date; to: Date } | undefined
  >(excludeRangeFromFilters(initialFilters))
  const [filters, setFilters] = useState<Filters>({
    fleetNo: initialFilters.fleetNo ?? "",
    partNumber: initialFilters.partNumber ?? "",
    materialName: initialFilters.materialName ?? "",
    startDate: initialFilters.startDate ?? "",
    endDate: initialFilters.endDate ?? "",
  })

  const isFirstRender = useRef(true)
  const filtersRef = useRef(filters)
  const categoriesRef = useRef(categories)
  const excludeDatesRef = useRef(excludeDates)
  filtersRef.current = filters
  categoriesRef.current = categories
  excludeDatesRef.current = excludeDates
  const subEquipmentAnchor = useComboboxAnchor()

  function pushFiltersToUrl(
    next: Filters,
    nextCategories: string[],
    nextExcludeDates: ExcludeDateRange | undefined = excludeDatesRef.current
  ) {
    const queryString = buildQueryString(next, nextCategories, nextExcludeDates)
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    })
  }

  // Text fields wait until the operator pauses so each keystroke doesn't
  // hit the database. Sub-equipment and dates apply as soon as they change.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    const timeout = setTimeout(() => {
      pushFiltersToUrl(filtersRef.current, categoriesRef.current)
    }, FILTER_DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  }, [filters.fleetNo, filters.partNumber, filters.materialName, pathname, router])

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function updateDiscreteFilter<K extends "startDate" | "endDate">(
    key: K,
    value: Filters[K]
  ) {
    setFilters((current) => {
      const next = { ...current, [key]: value }
      pushFiltersToUrl(next, categoriesRef.current)
      return next
    })
  }

  function updateCategories(nextCategories: string[]) {
    setCategories(nextCategories)
    pushFiltersToUrl(filtersRef.current, nextCategories)
  }

  function updateExcludeDates(next: ExcludeDateRange | undefined) {
    setExcludeDates(next)
    pushFiltersToUrl(filtersRef.current, categoriesRef.current, next)
  }

  // Clearing skips the debounce the effect above applies to typing, so the
  // table empties on the click rather than 300ms later.
  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    setCategories([])
    setExcludeDates(undefined)
    router.replace(pathname, { scroll: false })
  }

  const hasActiveFilters =
    Object.values(filters).some(Boolean) ||
    categories.length > 0 ||
    excludeDates !== undefined
  const subEquipmentItems = [
    ...SUB_EQUIPMENT_OPTIONS,
    ...categories.filter(
      (category) => !SUB_EQUIPMENT_OPTIONS.includes(category)
    ),
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Filters</CardTitle>
        <CardDescription>
          Narrow the history by asset, part, one or more sub equipment
          categories, or a date range.
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            disabled={!hasActiveFilters}
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-fleet-no">Fleet No (Identity No)</Label>
            <Input
              id="filter-fleet-no"
              placeholder="e.g. MT124(TRAILER124)"
              value={filters.fleetNo}
              onChange={(e) => updateFilter("fleetNo", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-part-number">Part Number</Label>
            <Input
              id="filter-part-number"
              placeholder="e.g. LED002"
              value={filters.partNumber}
              onChange={(e) => updateFilter("partNumber", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-material-name">Material Name</Label>
            <Input
              id="filter-material-name"
              placeholder="e.g. brake pad"
              value={filters.materialName}
              onChange={(e) => updateFilter("materialName", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-sub-equipment">Sub Equipment</Label>
            <Combobox
              multiple
              autoHighlight
              items={subEquipmentItems}
              value={categories}
              onValueChange={(value) =>
                updateCategories(Array.isArray(value) ? value : [])
              }
            >
              <ComboboxChips ref={subEquipmentAnchor} className="w-full">
                <ComboboxValue>
                  {(selected: string[]) => {
                    const values = Array.isArray(selected) ? selected : []
                    return (
                      <>
                        {values.map((category) => (
                          <ComboboxChip key={category}>{category}</ComboboxChip>
                        ))}
                        <ComboboxChipsInput
                          id="filter-sub-equipment"
                          placeholder={
                            values.length === 0
                              ? "Select sub equipment"
                              : "Add sub equipment"
                          }
                        />
                      </>
                    )
                  }}
                </ComboboxValue>
              </ComboboxChips>
              <ComboboxContent anchor={subEquipmentAnchor}>
                <ComboboxEmpty>No sub equipment found.</ComboboxEmpty>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-start-date">Start Date</Label>
            <Input
              id="filter-start-date"
              type="date"
              value={filters.startDate}
              onChange={(e) => updateDiscreteFilter("startDate", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-end-date">End Date</Label>
            <Input
              id="filter-end-date"
              type="date"
              value={filters.endDate}
              onChange={(e) => updateDiscreteFilter("endDate", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-exclude-dates">Exclude Dates</Label>
            <DatePickerWithRange
              id="filter-exclude-dates"
              date={excludeDates}
              setDate={updateExcludeDates}
            />
            {excludeDates ? (
              <div className="print:hidden">
                <Badge variant="destructive">
                  Excluding: {format(excludeDates.from, "MMM d")} -{" "}
                  {format(excludeDates.to, "MMM d")}
                </Badge>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
