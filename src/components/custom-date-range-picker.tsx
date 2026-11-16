"use client"

import { X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useMemo } from "react"

import { DatePickerWithRange } from "@/components/date-picker-with-range"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { formatIsoDate, parseIsoDate } from "@/lib/iso-date"
import { cn } from "@/lib/utils"

// Custom `?from=YYYY-MM-DD&to=YYYY-MM-DD` range selector for the Executive
// Statement and Director's Summary. It is a thin URL-state wrapper around the
// shadcn Calendar (react-day-picker, range mode) in a Popover: picking a range
// rewrites the search params and the server page re-queries; clearing removes
// them so the page falls back to its Monthly / MTD period.
export function CustomDateRangePicker({
  from,
  to,
  className,
  transformParams,
}: {
  // The range currently applied by the server page (already validated).
  from?: string
  to?: string
  className?: string
  // Lets a page adjust the other params before navigating (e.g. keep
  // client-only selections). Receives a mutable copy of the current params.
  transformParams?: (params: URLSearchParams) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Memoised on the ISO strings so the Date identities stay stable between
  // renders (DatePickerWithRange resets its draft whenever `date` changes).
  const date = useMemo(() => {
    const fromDate = parseIsoDate(from)
    const toDate = parseIsoDate(to)
    return fromDate && toDate ? { from: fromDate, to: toDate } : undefined
  }, [from, to])

  function navigate(range: { from: Date; to: Date } | undefined) {
    const params = new URLSearchParams(searchParams.toString())
    if (range) {
      params.set("from", formatIsoDate(range.from))
      params.set("to", formatIsoDate(range.to))
    } else {
      params.delete("from")
      params.delete("to")
    }
    transformParams?.(params)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div className={cn("flex min-w-[260px] flex-col gap-1.5 print:hidden", className)}>
      <Label htmlFor="custom-date-range">Custom date range</Label>
      <div className="flex items-center gap-1">
        <DatePickerWithRange
          id="custom-date-range"
          date={date}
          setDate={navigate}
          className="min-w-[240px]"
        />
        {date ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear custom date range"
            onClick={() => navigate(undefined)}
          >
            <X />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
