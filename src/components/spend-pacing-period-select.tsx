"use client"

import { usePathname, useRouter } from "next/navigation"

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

// Drives the `?period=YYYY-MM` search param that scopes the Daily and
// Weekly spend pacing charts below. The Monthly Spend trend chart is
// intentionally not wired to this control — it always shows full history.
export function SpendPacingPeriodSelect({
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
    <div className="flex max-w-[260px] flex-col gap-1.5">
      <Label htmlFor="spend-pacing-period">Spend pacing month</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id="spend-pacing-period" className="w-full">
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
      <p className="text-xs text-muted-foreground">
        Filters the Daily and Weekly spend pacing charts below. Monthly
        spend history is unaffected.
      </p>
    </div>
  )
}
