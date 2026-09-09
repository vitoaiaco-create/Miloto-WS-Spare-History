"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

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
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SparesHistoryFilters } from "@/lib/spares-history"

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

type Filters = Required<SparesHistoryFilters>

const EMPTY_FILTERS: Filters = {
  fleetNo: "",
  partNumber: "",
  materialName: "",
  subEquipment: "",
  startDate: "",
  endDate: "",
}

// Debounce (ms) before free-text filter changes push a new URL, so the
// server-rendered table doesn't re-fetch on every keystroke.
const FILTER_DEBOUNCE_MS = 400

function buildQueryString(filters: Filters) {
  const params = new URLSearchParams()
  if (filters.fleetNo) params.set("fleetNo", filters.fleetNo)
  if (filters.partNumber) params.set("partNumber", filters.partNumber)
  if (filters.materialName) params.set("materialName", filters.materialName)
  if (filters.subEquipment) params.set("subEquipment", filters.subEquipment)
  if (filters.startDate) params.set("startDate", filters.startDate)
  if (filters.endDate) params.set("endDate", filters.endDate)
  return params.toString()
}

export function SparesFilterBar({
  initialFilters,
}: {
  initialFilters: SparesHistoryFilters
}) {
  const router = useRouter()
  const pathname = usePathname()

  const [filters, setFilters] = useState<Filters>({
    ...EMPTY_FILTERS,
    ...initialFilters,
  })

  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }

    const timeout = setTimeout(() => {
      const queryString = buildQueryString(filters)
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
        scroll: false,
      })
    }, FILTER_DEBOUNCE_MS)

    return () => clearTimeout(timeout)
  }, [filters, pathname, router])

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  // Clearing skips the debounce the effect above applies to typing, so the
  // table empties on the click rather than 400ms later.
  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    router.replace(pathname, { scroll: false })
  }

  const hasActiveFilters = Object.values(filters).some(Boolean)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Filters</CardTitle>
        <CardDescription>
          Narrow the history by asset, part, sub equipment or date range.
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
              items={SUB_EQUIPMENT_OPTIONS}
              value={filters.subEquipment || null}
              onValueChange={(value) =>
                updateFilter("subEquipment", value ?? "")
              }
            >
              <ComboboxTrigger
                render={
                  <Button
                    id="filter-sub-equipment"
                    variant="outline"
                    className="w-full justify-between font-normal"
                  />
                }
              >
                <ComboboxValue placeholder="Select sub equipment" />
              </ComboboxTrigger>
              <ComboboxContent>
                <ComboboxInput
                  showTrigger={false}
                  placeholder="Search sub equipment..."
                />
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
              onChange={(e) => updateFilter("startDate", e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-end-date">End Date</Label>
            <Input
              id="filter-end-date"
              type="date"
              value={filters.endDate}
              onChange={(e) => updateFilter("endDate", e.target.value)}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
