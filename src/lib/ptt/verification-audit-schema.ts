import { z } from "zod"

import type { PttFaultSeverity } from "../ptt-diagnostics"
import type { PttCaseStatus, PttReconciliationBucket } from "./constants"
import { isBlockingSeverity, type ReconciledFault } from "./reconcile"

// Client-safe types, Zod schema and pure helpers for the VERIFICATION_AUDIT
// forensic pass (Pass 2, mode B). The OpenAI call itself lives in
// `verification-audit.ts` (server-only). Like `constants.ts` this file must
// NOT import `@/db/schema`: schema.ts imports the type from here.

export const pttVerificationAuditSchema = z.object({
  /** One concise sentence summarising the repair outcome. */
  verdictHeadline: z.string(),
  /** Required whenever there is a NEW_REGRESSION; correlates it with the cleared faults. */
  collateralDamageAnalysis: z.string().nullable(),
  /** Actionable persisting Critical / Calibration faults the workshop did not resolve. */
  untouchedBlockersSummary: z.string().nullable(),
  /** Required whenever a fault is a bounce-back / reopened. */
  repeatFaultEscalation: z.string().nullable(),
  /** 1-4 short, concrete floor instructions. */
  nextFloorActions: z.array(z.string()),
})

export type PttVerificationAudit = z.infer<typeof pttVerificationAuditSchema>

export const MAX_FLOOR_ACTIONS = 4

/** One fault of the deterministic 5-bucket reconciliation, as the audit sees it. */
export type VerificationAuditFault = {
  canonicalKey: string
  ecuLabel: string
  description: string
  severity: PttFaultSeverity
  isBounceBack: boolean
  /** Times the ledger has reopened this fault after a clear. */
  reopenCount: number
}

export type VerificationAuditInput = {
  caseStatus: PttCaseStatus
  cleared: VerificationAuditFault[]
  persistingOpen: VerificationAuditFault[]
  newRegressions: VerificationAuditFault[]
  persistingExceptions: VerificationAuditFault[]
  newExceptions: VerificationAuditFault[]
  /** Faults with `isBounceBack` or `reopenCount >= 1` (any bucket). */
  bounceBackItems: VerificationAuditFault[]
}

/**
 * Maps the reconciliation buckets (plus the ledger's reopen counts) to the
 * audit input. A bounce-back is a fault flagged `isBounceBack` or reopened at
 * least once before.
 */
export function buildVerificationAuditInput(
  buckets: Readonly<Record<PttReconciliationBucket, readonly ReconciledFault[]>>,
  caseStatus: PttCaseStatus,
  reopenCounts: ReadonlyMap<string, number>
): VerificationAuditInput {
  const toFault = (fault: ReconciledFault): VerificationAuditFault => ({
    canonicalKey: fault.canonicalKey,
    ecuLabel: fault.ecuLabel,
    description: fault.description,
    severity: fault.severity,
    isBounceBack: fault.isBounceBack,
    reopenCount: reopenCounts.get(fault.canonicalKey) ?? 0,
  })

  const cleared = buckets.CLEARED.map(toFault)
  const persistingOpen = buckets.PERSISTING_OPEN.map(toFault)
  const newRegressions = buckets.NEW_REGRESSION.map(toFault)
  const persistingExceptions = buckets.PERSISTING_EXCEPTION.map(toFault)
  const newExceptions = buckets.NEW_EXCEPTION.map(toFault)

  return {
    caseStatus,
    cleared,
    persistingOpen,
    newRegressions,
    persistingExceptions,
    newExceptions,
    bounceBackItems: [
      ...newRegressions,
      ...persistingOpen,
      ...persistingExceptions,
      ...newExceptions,
    ].filter((fault) => isBounceBackItem(fault)),
  }
}

export function isBounceBackItem(
  fault: Pick<VerificationAuditFault, "isBounceBack" | "reopenCount">
): boolean {
  return fault.isBounceBack || fault.reopenCount >= 1
}

/** Persisting faults that still block a closure (Critical / Calibration). */
export function blockingPersistingFaults(
  input: Pick<VerificationAuditInput, "persistingOpen">
): VerificationAuditFault[] {
  return input.persistingOpen.filter((fault) => isBlockingSeverity(fault.severity))
}

const keys = (faults: readonly VerificationAuditFault[]) =>
  faults.map((fault) => fault.canonicalKey).join(", ")

const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? ""
  return trimmed === "" ? null : trimmed
}

/**
 * Deterministic guard around the model's audit so the "required whenever"
 * contracts always hold: a required field the model left empty is filled with
 * a plain-text fallback, a field that must not appear (no regressions /
 * blockers / bounce-backs) is nulled, and the floor actions are kept to 1-4.
 */
export function normalizeVerificationAudit(
  audit: PttVerificationAudit | null,
  input: VerificationAuditInput
): PttVerificationAudit {
  const blockers = blockingPersistingFaults(input)
  const hasRegressions = input.newRegressions.length > 0
  const hasBounceBacks = input.bounceBackItems.length > 0

  const headline =
    blankToNull(audit?.verdictHeadline) ??
    (input.caseStatus === "VERIFIED_CLOSED"
      ? `Repair verified: ${input.cleared.length} fault(s) cleared and no blocking faults or regressions remain.`
      : `Repair incomplete: ${input.cleared.length} cleared, ${blockers.length} blocking fault(s) still open, ${input.newRegressions.length} new regression(s).`)

  const collateralDamageAnalysis = hasRegressions
    ? (blankToNull(audit?.collateralDamageAnalysis) ??
      `New regression(s) after the repair: ${keys(input.newRegressions)}. Correlate each with the faults just cleared (${input.cleared.length > 0 ? keys(input.cleared) : "none"}) by ECU, harness branch and physical proximity: a connector or loom disturbed during the repair is the first suspect. Inspect connector seating, pin condition and loom routing on the disturbed branch before ordering any part.`)
    : null

  const untouchedBlockersSummary =
    blockers.length > 0
      ? (blankToNull(audit?.untouchedBlockersSummary) ??
        `Still open and blocking: ${keys(blockers)}. The workshop has not resolved these Critical / Calibration faults.`)
      : null

  const repeatFaultEscalation = hasBounceBacks
    ? (blankToNull(audit?.repeatFaultEscalation) ??
      `Repeat fault(s): ${keys(input.bounceBackItems)}. Do NOT clear the DTC or wiggle the connector again. Prove the root cause: pin drag test on the connector, load-test the wires under current, or measure mechanical wear.`)
    : null

  const actions = (audit?.nextFloorActions ?? [])
    .map((action) => action.trim())
    .filter((action) => action !== "")
    .slice(0, MAX_FLOOR_ACTIONS)
  if (actions.length === 0) {
    if (hasRegressions) {
      actions.push(
        `Inspect the connector and loom disturbed during the repair for regression(s) ${keys(input.newRegressions)}.`
      )
    }
    if (blockers.length > 0) {
      actions.push(
        `Resolve the blocking fault(s) ${keys(blockers)} and upload a new post-work PTT scan.`
      )
    }
    if (actions.length === 0) {
      actions.push("No blocking faults remain: close the job card and release the truck.")
    }
  }

  return {
    verdictHeadline: headline,
    collateralDamageAnalysis,
    untouchedBlockersSummary,
    repeatFaultEscalation,
    nextFloorActions: actions.slice(0, MAX_FLOOR_ACTIONS),
  }
}
