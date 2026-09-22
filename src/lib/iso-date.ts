const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

// Calendar dates only (`YYYY-MM-DD`). `Date#toISOString()` is UTC and can
// shift the day for a local midnight in a positive offset.
export function toIsoDateParam(value: string | undefined) {
  if (!value) return ""

  const match = ISO_DATE.exec(value)
  if (!match) return ""

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return ""
  }

  return `${match[1]}-${match[2]}-${match[3]}`
}

export function parseIsoDate(value: string | undefined) {
  const iso = toIsoDateParam(value)
  if (!iso) return undefined

  const [year, month, day] = iso.split("-").map(Number)
  return new Date(year, month - 1, day)
}

export function formatIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
