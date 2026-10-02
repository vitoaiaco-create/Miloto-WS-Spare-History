// Shared `?period=YYYY-MM` handling for the Workshop Analytics daily/weekly
// spend-pacing charts. Deliberately separate from the Monthly Spend chart
// (`getYtdAnalytics`), which always shows the full historical trend and
// must never be scoped by this parameter.

export type AnalyticsPeriod = {
  year: number
  month: number // 1-12
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

const PERIOD_PARAM = /^(\d{4})-(\d{2})$/

export function currentAnalyticsPeriod(referenceDate: Date = new Date()): AnalyticsPeriod {
  return {
    year: referenceDate.getFullYear(),
    month: referenceDate.getMonth() + 1,
  }
}

function isAnalyticsPeriodInFuture(
  period: AnalyticsPeriod,
  referenceDate: Date = new Date()
) {
  const current = currentAnalyticsPeriod(referenceDate)
  if (period.year !== current.year) return period.year > current.year
  return period.month > current.month
}

// Parses the `period` search param (`YYYY-MM`). Falls back to the current
// calendar month when the value is missing, malformed, or in the future —
// the selector only ever offers past/current months, but the URL is user
// editable.
export function parseAnalyticsPeriod(
  value: string | string[] | undefined,
  referenceDate: Date = new Date()
): AnalyticsPeriod {
  const raw = typeof value === "string" ? value : undefined
  const match = raw ? PERIOD_PARAM.exec(raw) : null

  if (!match) return currentAnalyticsPeriod(referenceDate)

  const year = Number(match[1])
  const month = Number(match[2])

  if (month < 1 || month > 12) return currentAnalyticsPeriod(referenceDate)

  const period = { year, month }
  return isAnalyticsPeriodInFuture(period, referenceDate)
    ? currentAnalyticsPeriod(referenceDate)
    : period
}

export function formatAnalyticsPeriod(period: AnalyticsPeriod): string {
  return `${period.year}-${String(period.month).padStart(2, "0")}`
}

export function analyticsPeriodLabel(period: AnalyticsPeriod): string {
  return `${MONTH_NAMES[period.month - 1]} ${period.year}`
}

export function areSameAnalyticsPeriod(
  left: AnalyticsPeriod,
  right: AnalyticsPeriod
): boolean {
  return left.year === right.year && left.month === right.month
}

// Most recent `count` calendar months (including the current one), newest
// first, for populating the month selector.
export function analyticsPeriodOptions(
  count = 24,
  referenceDate: Date = new Date()
): { value: string; label: string }[] {
  const current = currentAnalyticsPeriod(referenceDate)
  const currentIndex = current.year * 12 + (current.month - 1)

  return Array.from({ length: count }, (_, offset) => {
    const index = currentIndex - offset
    const period = {
      year: Math.floor(index / 12),
      month: (index % 12) + 1,
    }

    return {
      value: formatAnalyticsPeriod(period),
      label: analyticsPeriodLabel(period),
    }
  })
}
