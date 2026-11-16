// Shared (client + server safe) handling for the `?from=YYYY-MM-DD&to=YYYY-MM-DD`
// custom date range used by the Executive Statement and Director's Summary.
// When both params are valid they override the Monthly / MTD period.

import { format } from "date-fns"
import { z } from "zod"

import { parseIsoDate, toIsoDateParam } from "@/lib/iso-date"

export type CustomDateRange = {
  // Inclusive calendar days, `YYYY-MM-DD`, with `from <= to`.
  from: string
  to: string
}

const isoDaySchema = z
  .string()
  .refine((value) => toIsoDateParam(value) !== "", "Expected YYYY-MM-DD")

const rangeParamsSchema = z.object({
  from: isoDaySchema,
  to: isoDaySchema,
})

// Next.js hands search params over as `string | string[] | undefined`; only a
// single string value is meaningful here.
type SearchParamValue = string | string[] | undefined

// Returns null unless BOTH params are valid calendar days, so a half-typed or
// hand-edited URL falls back to the Monthly / MTD logic. A reversed range
// (`from` after `to`) is swapped rather than rejected.
export function parseCustomDateRange(
  from: SearchParamValue,
  to: SearchParamValue
): CustomDateRange | null {
  const parsed = rangeParamsSchema.safeParse({
    from: typeof from === "string" ? from : undefined,
    to: typeof to === "string" ? to : undefined,
  })
  if (!parsed.success) return null

  const { from: start, to: end } = parsed.data
  return start <= end ? { from: start, to: end } : { from: end, to: start }
}

// e.g. "27 Oct 2026 – 15 Nov 2026".
export function formatCustomDateRange(range: CustomDateRange) {
  const from = parseIsoDate(range.from)
  const to = parseIsoDate(range.to)
  if (!from || !to) return `${range.from} – ${range.to}`
  return `${format(from, "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`
}
