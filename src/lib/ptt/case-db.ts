import "server-only"

import { eq, sql } from "drizzle-orm"
import type { BatchItem } from "drizzle-orm/batch"

import { db } from "@/db"
import {
  pttFaultCodesTable,
  pttScanFaultsTable,
  pttTruckFaultLedgerTable,
} from "@/db/schema"
import type { PttTruckGeneration } from "@/lib/ptt-diagnostics"
import type { PttReconciliationBucket } from "./constants"
import type { LedgerEntry } from "./ledger"
import type { ApprovedExceptionRule } from "./reconcile"
import { buildScanFaultRecords, type ScanFaultRecord } from "./scan-faults"

// Drizzle reads / statement builders shared by the baseline route, the
// verification route and the exception-approval action. Builders return
// un-awaited statements so callers can run them in one atomic `db.batch`
// (the neon-http driver has no interactive transactions).

/** Active approved exceptions that apply to this truck (its generation or the fleet id). */
export async function loadApplicableExceptions(
  fleetId: string,
  generation: PttTruckGeneration
): Promise<ApprovedExceptionRule[]> {
  const rows = await db.query.pttApprovedExceptionsTable.findMany({
    where: {
      isActive: true,
      OR:
        generation === "UNKNOWN"
          ? [{ scope: "TRUCK_SPECIFIC", fleetId }]
          : [
              { scope: "FLEET_GENERATION", generation },
              { scope: "TRUCK_SPECIFIC", fleetId },
            ],
    },
  })
  return rows.map((row) => ({
    scope: row.scope,
    generation: row.generation,
    fleetId: row.fleetId,
    canonicalKey: row.canonicalKey,
    isActive: row.isActive,
  }))
}

/** The truck's ledger rows keyed by canonical key. */
export async function loadLedgerMap(
  fleetId: string
): Promise<Map<string, LedgerEntry>> {
  const rows = await db.query.pttTruckFaultLedgerTable.findMany({
    where: { fleetId },
  })
  return new Map(
    rows.map((row): [string, LedgerEntry] => [
      row.canonicalKey,
      {
        fleetId: row.fleetId,
        canonicalKey: row.canonicalKey,
        ecuLabel: row.ecuLabel,
        description: row.description,
        latestSeverity: row.latestSeverity,
        ledgerStatus: row.ledgerStatus,
        firstSeenScanId: row.firstSeenScanId,
        lastSeenScanId: row.lastSeenScanId,
        clearedScanId: row.clearedScanId,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        clearedAt: row.clearedAt,
        reopenCount: row.reopenCount,
        lastReopenedAt: row.lastReopenedAt,
      },
    ])
  )
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
 * One multi-row upsert on (fleetId, canonicalKey). Every planned row is a
 * complete final state, so the conflict branch simply takes the incoming
 * values (`excluded.*` has no query-builder equivalent).
 */
export function ledgerUpsertStatement(
  entries: readonly LedgerEntry[]
): BatchItem<"pg"> | null {
  if (entries.length === 0) return null
  return db
    .insert(pttTruckFaultLedgerTable)
    .values(entries.map((entry) => ({ ...entry })))
    .onConflictDoUpdate({
      target: [
        pttTruckFaultLedgerTable.fleetId,
        pttTruckFaultLedgerTable.canonicalKey,
      ],
      set: {
        ecuLabel: sql`excluded.ecu_label`,
        description: sql`excluded.description`,
        latestSeverity: sql`excluded.latest_severity`,
        ledgerStatus: sql`excluded.ledger_status`,
        firstSeenScanId: sql`excluded.first_seen_scan_id`,
        lastSeenScanId: sql`excluded.last_seen_scan_id`,
        clearedScanId: sql`excluded.cleared_scan_id`,
        firstSeenAt: sql`excluded.first_seen_at`,
        lastSeenAt: sql`excluded.last_seen_at`,
        clearedAt: sql`excluded.cleared_at`,
        reopenCount: sql`excluded.reopen_count`,
        lastReopenedAt: sql`excluded.last_reopened_at`,
      },
    })
}

export type ScanFaultRowOptions = {
  scanId: number
  bucketByKey: ReadonlyMap<string, PttReconciliationBucket>
  bounceBackKeys: ReadonlySet<string>
  exceptionKeys: ReadonlySet<string>
}

/** Insert rows for the extracted faults of a scan (one per canonical key). */
export function toScanFaultRows(
  records: readonly ScanFaultRecord[],
  options: ScanFaultRowOptions
): (typeof pttScanFaultsTable.$inferInsert)[] {
  return records.map((record) => ({
    scanId: options.scanId,
    canonicalKey: record.canonicalKey,
    ecuLabel: record.ecuLabel,
    dtcRaw: record.dtcRaw,
    description: record.description,
    pttStatus: record.pttStatus,
    severity: record.severity,
    reconciliationBucket: options.bucketByKey.get(record.canonicalKey) ?? null,
    isBounceBack:
      record.pttStatus === "ACTIVE" &&
      options.bounceBackKeys.has(record.canonicalKey),
    isApprovedException: options.exceptionKeys.has(record.canonicalKey),
    isExtracted: true,
    keyNeedsReview: record.keyNeedsReview,
    keyReviewReason: record.keyReviewReason,
  }))
}

/** Sets the reconciliation bucket / exception flag of one stored scan fault. */
export function updateScanFaultBucket(
  scanFaultId: number,
  values: {
    reconciliationBucket: PttReconciliationBucket | null
    isApprovedException: boolean
  }
): BatchItem<"pg"> {
  return db
    .update(pttScanFaultsTable)
    .set(values)
    .where(eq(pttScanFaultsTable.id, scanFaultId))
}

type ScanFaultRow = typeof pttScanFaultsTable.$inferSelect
type LegacyFaultRow = typeof pttFaultCodesTable.$inferSelect

/** A stored `ptt_scan_faults` row as the pure engine's record shape. */
export function recordFromScanFaultRow(row: ScanFaultRow): ScanFaultRecord {
  return {
    canonicalKey: row.canonicalKey,
    ecuLabel: row.ecuLabel,
    dtcRaw: row.dtcRaw,
    description: row.description,
    pttStatus: row.pttStatus,
    severity: row.severity,
    keyNeedsReview: row.keyNeedsReview,
    keyReviewReason: row.keyReviewReason,
    isVcads: row.canonicalKey.startsWith("VCADS|"),
  }
}

export type BaselineSnapshot = {
  records: ScanFaultRecord[]
  /** True when the rows were derived from legacy `ptt_fault_codes` and still need storing. */
  needsBackfill: boolean
}

/**
 * The baseline's fault snapshot. Scans created before the reconciliation
 * engine only have `ptt_fault_codes`; their snapshot is derived on first use
 * (and stored by the caller) so existing cases can be verified.
 */
export async function loadBaselineSnapshot(baseline: {
  id: number
  truckGeneration: PttTruckGeneration
  faults: readonly LegacyFaultRow[]
}): Promise<BaselineSnapshot> {
  const stored = await db.query.pttScanFaultsTable.findMany({
    where: { scanId: baseline.id },
  })
  if (stored.length > 0) {
    return { records: stored.map(recordFromScanFaultRow), needsBackfill: false }
  }
  return {
    records: buildScanFaultRecords(
      baseline.faults.map((fault) => ({
        controlUnit: fault.controlUnit,
        faultCode: fault.faultCode,
        description: fault.componentDescription,
        faultState: fault.faultState,
        severity: fault.severity,
      })),
      baseline.truckGeneration
    ),
    needsBackfill: true,
  }
}
