import type { PttFaultSeverity } from "../ptt-diagnostics"
import {
  PTT_BOUNCE_BACK_WINDOW_DAYS,
  type PttLedgerStatus,
} from "./constants"

// Pure planning of the living truck-level fault ledger
// (`ptt_truck_fault_ledger`). Given the ledger rows that already exist for a
// truck and what a scan just showed, it returns the exact rows to upsert and
// which keys are 30-day bounce-backs. The server writes the plan inside one
// atomic `db.batch`.

const DAY_MS = 24 * 60 * 60 * 1000

export type LedgerEntry = {
  fleetId: string
  canonicalKey: string
  ecuLabel: string
  description: string
  latestSeverity: PttFaultSeverity
  ledgerStatus: PttLedgerStatus
  firstSeenScanId: number | null
  lastSeenScanId: number | null
  clearedScanId: number | null
  firstSeenAt: Date
  lastSeenAt: Date
  clearedAt: Date | null
  reopenCount: number
  lastReopenedAt: Date | null
}

export type LedgerScanFault = {
  canonicalKey: string
  ecuLabel: string
  description: string
  severity: PttFaultSeverity
  isApprovedException: boolean
}

/** True when a CLEARED entry was cleared within the bounce-back window. */
export function isWithinBounceBackWindow(
  entry: Pick<LedgerEntry, "ledgerStatus" | "clearedAt">,
  now: Date
): boolean {
  if (entry.ledgerStatus !== "CLEARED" || entry.clearedAt === null) return false
  const elapsed = now.getTime() - entry.clearedAt.getTime()
  return elapsed >= 0 && elapsed <= PTT_BOUNCE_BACK_WINDOW_DAYS * DAY_MS
}

/**
 * Active keys whose ledger row was CLEARED within the bounce-back window.
 * Approved exceptions are never bounce-backs (a manual air-dryer code coming
 * back is not a workshop failure).
 */
export function detectBounceBacks(
  existing: ReadonlyMap<string, LedgerEntry>,
  activeFaults: ReadonlyArray<Pick<LedgerScanFault, "canonicalKey" | "isApprovedException">>,
  now: Date
): Set<string> {
  const keys = new Set<string>()
  for (const fault of activeFaults) {
    const current = existing.get(fault.canonicalKey)
    if (
      current &&
      !fault.isApprovedException &&
      isWithinBounceBackWindow(current, now)
    ) {
      keys.add(fault.canonicalKey)
    }
  }
  return keys
}

export type LedgerPlanInput = {
  fleetId: string
  /** The scan being committed (already inserted, so its id is known). */
  scanId: number
  /** One timestamp for the whole commit. */
  now: Date
  /** Faults ACTIVE in this scan. */
  activeFaults: readonly LedgerScanFault[]
  /** Baseline faults this (verification) scan proved CLEARED. */
  clearedFaults?: readonly LedgerScanFault[]
  /** Existing ledger rows for the truck, keyed by canonical key. */
  existing: ReadonlyMap<string, LedgerEntry>
}

export type LedgerPlan = {
  /** New / changed rows only, ready to upsert on (fleetId, canonicalKey). */
  upserts: LedgerEntry[]
  /**
   * Active keys whose ledger row was CLEARED within the last 30 days: the
   * repair did not hold. Approved exceptions are never bounce-backs.
   */
  bounceBackKeys: Set<string>
}

/**
 * Plans the ledger update for one baseline or verification commit.
 *
 *  - Active fault, no row                    -> OPEN (APPROVED_EXCEPTION if exempt)
 *  - Active fault, CLEARED <= 30 days ago    -> REOPENED, reopenCount + 1,
 *                                               lastReopenedAt = now (bounce-back)
 *  - Active fault, CLEARED > 30 days ago     -> OPEN as a new episode
 *  - Active fault, already open              -> last-seen / severity refreshed
 *  - Cleared fault (verification)            -> CLEARED, clearedScanId, clearedAt = now
 */
export function planLedgerCommit(input: LedgerPlanInput): LedgerPlan {
  const { fleetId, scanId, now, existing } = input
  const upserts = new Map<string, LedgerEntry>()
  const bounceBackKeys = detectBounceBacks(existing, input.activeFaults, now)

  for (const fault of input.activeFaults) {
    const current = existing.get(fault.canonicalKey)
    const base = {
      fleetId,
      canonicalKey: fault.canonicalKey,
      ecuLabel: fault.ecuLabel,
      description: fault.description,
      latestSeverity: fault.severity,
      lastSeenScanId: scanId,
      lastSeenAt: now,
    }
    const openStatus: PttLedgerStatus = fault.isApprovedException
      ? "APPROVED_EXCEPTION"
      : "OPEN"

    if (!current) {
      upserts.set(fault.canonicalKey, {
        ...base,
        ledgerStatus: openStatus,
        firstSeenScanId: scanId,
        firstSeenAt: now,
        clearedScanId: null,
        clearedAt: null,
        reopenCount: 0,
        lastReopenedAt: null,
      })
      continue
    }

    if (current.ledgerStatus === "CLEARED") {
      if (bounceBackKeys.has(fault.canonicalKey)) {
        upserts.set(fault.canonicalKey, {
          ...current,
          ...base,
          ledgerStatus: "REOPENED",
          clearedScanId: null,
          clearedAt: null,
          reopenCount: current.reopenCount + 1,
          lastReopenedAt: now,
        })
      } else {
        // Came back after the window (or is an exempt code): a fresh episode.
        upserts.set(fault.canonicalKey, {
          ...current,
          ...base,
          ledgerStatus: openStatus,
          firstSeenScanId: scanId,
          firstSeenAt: now,
          clearedScanId: null,
          clearedAt: null,
        })
      }
      continue
    }

    // Already open (OPEN / REOPENED / APPROVED_EXCEPTION): refresh it. An
    // exception wins; a code that lost its exception goes back to OPEN.
    const keepsStatus =
      current.ledgerStatus === "REOPENED" && !fault.isApprovedException
    upserts.set(fault.canonicalKey, {
      ...current,
      ...base,
      ledgerStatus: keepsStatus ? "REOPENED" : openStatus,
    })
  }

  for (const fault of input.clearedFaults ?? []) {
    const current = upserts.get(fault.canonicalKey) ?? existing.get(fault.canonicalKey)
    upserts.set(fault.canonicalKey, {
      fleetId,
      canonicalKey: fault.canonicalKey,
      ecuLabel: current?.ecuLabel ?? fault.ecuLabel,
      description: current?.description || fault.description,
      latestSeverity: fault.severity,
      firstSeenScanId: current?.firstSeenScanId ?? scanId,
      firstSeenAt: current?.firstSeenAt ?? now,
      lastSeenScanId: current?.lastSeenScanId ?? null,
      lastSeenAt: current?.lastSeenAt ?? now,
      reopenCount: current?.reopenCount ?? 0,
      lastReopenedAt: current?.lastReopenedAt ?? null,
      ledgerStatus: "CLEARED",
      clearedScanId: scanId,
      clearedAt: now,
    })
  }

  return { upserts: [...upserts.values()], bounceBackKeys }
}

/** Folds planned upserts into an in-memory ledger map (for chained plans). */
export function applyUpserts(
  ledger: ReadonlyMap<string, LedgerEntry>,
  upserts: readonly LedgerEntry[]
): Map<string, LedgerEntry> {
  const next = new Map(ledger)
  for (const entry of upserts) next.set(entry.canonicalKey, entry)
  return next
}

/**
 * Merges the history of a legacy ledger row (e.g. an `UNVERIFIED|...` key that
 * was repaired) into the row of its repaired key: the earliest first sighting,
 * the highest reopen count and the latest reopen date survive.
 */
export function mergeLedgerEntries(
  target: LedgerEntry,
  legacy: LedgerEntry
): LedgerEntry {
  const legacyIsEarlier = legacy.firstSeenAt.getTime() < target.firstSeenAt.getTime()
  const latestReopen = [target.lastReopenedAt, legacy.lastReopenedAt]
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0]
  return {
    ...target,
    firstSeenAt: legacyIsEarlier ? legacy.firstSeenAt : target.firstSeenAt,
    firstSeenScanId: legacyIsEarlier
      ? legacy.firstSeenScanId
      : target.firstSeenScanId,
    reopenCount: Math.max(target.reopenCount, legacy.reopenCount),
    lastReopenedAt: latestReopen ?? null,
  }
}

/**
 * Whole days the fault has been (or was) open: first seen -> cleared for a
 * CLEARED row, otherwise since it was last reopened (or first seen).
 */
export function ledgerDaysOpen(
  entry: Pick<
    LedgerEntry,
    "ledgerStatus" | "firstSeenAt" | "clearedAt" | "lastReopenedAt"
  >,
  now: Date
): number {
  const end =
    entry.ledgerStatus === "CLEARED" && entry.clearedAt ? entry.clearedAt : now
  const start =
    entry.ledgerStatus === "REOPENED" && entry.lastReopenedAt
      ? entry.lastReopenedAt
      : entry.firstSeenAt
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / DAY_MS))
}
