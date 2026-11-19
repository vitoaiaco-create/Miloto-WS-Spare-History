import { format } from "date-fns"

import type { DisciplinaryCaseWithAttachments } from "@/actions/hr-cases"
import {
  HR_DISCIPLINARY_STATUSES,
  type HrDisciplinaryStatus,
} from "@/db/schema"
import {
  EMPTY_DISCIPLINARY_DATA,
  type DisciplinaryData,
} from "@/lib/hr-disciplinary"

export { HR_DISCIPLINARY_STATUSES }
export type { HrDisciplinaryStatus }

export type DisciplinaryCase = DisciplinaryCaseWithAttachments

// Full column / badge titles used on the Kanban board.
export const STATUS_LABELS: Record<HrDisciplinaryStatus, string> = {
  AWAITING_SIGNATURE: "Charge Awaiting Signature",
  DISPUTED: "Charge Disputed",
  CLOSED: "Charge Closed",
}

// Compact labels used in dropdowns and the Historical Log.
export const STATUS_SHORT_LABELS: Record<HrDisciplinaryStatus, string> = {
  AWAITING_SIGNATURE: "Awaiting Signature",
  DISPUTED: "Disputed",
  CLOSED: "Closed",
}

const HOUR_MS = 60 * 60 * 1000

// Closed cases stay on the Kanban board for 7 days, then live only in the
// Historical Log. Nothing is ever deleted from the database.
export const CLOSED_VISIBLE_MS = 7 * 24 * HOUR_MS

// Show-cause window warnings for cases still awaiting a signature.
export const ELAPSED_WARNING_MS = 36 * HOUR_MS
export const ELAPSED_OVERDUE_MS = 48 * HOUR_MS

export function isRecentlyClosed(caseItem: DisciplinaryCase, now: number) {
  if (!caseItem.closedAt) return false
  return now - caseItem.closedAt.getTime() <= CLOSED_VISIBLE_MS
}

export function countActiveCases(cases: DisciplinaryCase[]) {
  return cases.filter((c) => c.status !== "CLOSED").length
}

export function formatCaseDateTime(date: Date) {
  return format(date, "dd MMM yyyy, HH:mm")
}

export function formatCaseDate(date: Date) {
  return format(date, "dd MMM yyyy")
}

// "5h 12m" under a day, "2d 4h" from a day onwards.
export function formatElapsed(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${hours}h`
  return `${hours}h ${minutes}m`
}

// Rebuilds the full docxtemplater payload from the stored 7 template fields
// plus the case identifiers (stored in their own columns, not in the JSON).
export function buildDocumentData(caseItem: DisciplinaryCase): DisciplinaryData {
  return {
    ...EMPTY_DISCIPLINARY_DATA,
    ...caseItem.documentPayload,
    case_ref: caseItem.caseRef,
    fleet_id: caseItem.fleetId,
  }
}
