import "server-only"

import { db } from "@/db"

// Shared Drizzle reads for PTT scan sessions (baseline scans with their
// post-work verification scans). Used by Server Components / Actions and by
// the Route Handlers that must return the refreshed session.

// A baseline's verification scans, newest first, each with its reconciliation
// snapshot rows and screenshots.
const sessionRelations = {
  faults: true,
  attachments: true,
  verificationScans: {
    with: { scanFaults: true, attachments: true },
    orderBy: { id: "desc" },
  },
} as const

/** Every baseline scan, newest first (verification scans hang off their baseline). */
export function queryBaselineSessions() {
  return db.query.pttDiagnosticSessionsTable.findMany({
    where: { scanRole: "BASELINE" },
    // `id` breaks ties so ordering is stable for same-instant scans.
    orderBy: { scannedAt: "desc", id: "desc" },
    with: sessionRelations,
  })
}

/** One session (normally a baseline) with all relations, or undefined. */
export function querySessionDetail(sessionId: number) {
  return db.query.pttDiagnosticSessionsTable.findFirst({
    where: { id: sessionId },
    with: sessionRelations,
  })
}

export type PttSessionDetail = NonNullable<
  Awaited<ReturnType<typeof querySessionDetail>>
>
