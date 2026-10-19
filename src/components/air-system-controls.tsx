"use client"

import { usePathname, useRouter } from "next/navigation"
import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  analyticsPeriodLabel,
  analyticsPeriodOptions,
  formatAnalyticsPeriod,
  type AnalyticsPeriod,
} from "@/lib/analytics-period"

export function AirSystemPeriodSelect({
  period,
}: {
  period: AnalyticsPeriod
}) {
  const router = useRouter()
  const pathname = usePathname()
  const value = formatAnalyticsPeriod(period)

  const options = analyticsPeriodOptions()
  const hasCurrentValue = options.some((option) => option.value === value)
  const selectableOptions = hasCurrentValue
    ? options
    : [{ value, label: analyticsPeriodLabel(period) }, ...options]

  function onValueChange(next: string | null) {
    if (!next || next === value) return

    router.replace(`${pathname}?period=${next}`, { scroll: false })
  }

  return (
    <div className="flex max-w-[220px] flex-col gap-1.5 print:hidden">
      <Label htmlFor="air-system-period">Test month</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id="air-system-period" className="w-full">
          <SelectValue placeholder="Select month" />
        </SelectTrigger>
        <SelectContent>
          {selectableOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function PrintChecklistButton() {
  return (
    <Button
      type="button"
      variant="outline"
      className="print:hidden"
      onClick={() => window.print()}
    >
      <Printer data-icon="inline-start" />
      Print Checklist
    </Button>
  )
}
