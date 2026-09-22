"use client"

import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { useEffect, useState } from "react"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function DatePickerWithRange({
  id,
  date,
  setDate,
  className,
}: {
  id?: string
  className?: string
  date: { from: Date; to: Date } | undefined
  setDate: (date: { from: Date; to: Date } | undefined) => void
}) {
  const [draft, setDraft] = useState<DateRange | undefined>(date)

  useEffect(() => {
    setDraft(date)
  }, [date])

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !draft?.from && "text-muted-foreground",
              className
            )}
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        {draft?.from ? (
          draft.to ? (
            <>
              {format(draft.from, "LLL dd, y")} - {format(draft.to, "LLL dd, y")}
            </>
          ) : (
            format(draft.from, "LLL dd, y")
          )
        ) : (
          <span>Pick a date range</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={draft?.from}
          selected={draft}
          onSelect={(range) => {
            setDraft(range)
            if (range?.from && range.to) {
              setDate({ from: range.from, to: range.to })
              return
            }
            if (!range?.from) setDate(undefined)
          }}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  )
}
