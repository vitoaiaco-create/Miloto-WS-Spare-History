import { format } from "date-fns"

import type { PttFaultSeverity } from "../ptt-diagnostics"
import {
  PTT_CASE_STATUS_LABELS,
  type PttCaseStatus,
  type PttGateOverride,
  type PttReconciliationBucket,
  type PttReconciliationSummary,
} from "./constants"
import type { PttVerificationAudit } from "./verification-audit-schema"

// Pure WhatsApp formatter for the deterministic Before/After audit (client
// safe: no DB or server imports).

export type PttAuditFault = {
  canonicalKey: string
  ecuLabel: string
  description: string
  severity: PttFaultSeverity
  reconciliationBucket: PttReconciliationBucket | null
  isBounceBack: boolean
}

export type PttVerificationAuditInput = {
  fleetId: string
  caseStatus: PttCaseStatus
  /** When the verification scan was taken. */
  scannedAt: Date
  summary: PttReconciliationSummary | null
  headerItemCount: number | null
  extractedItemCount: number | null
  gateOverrides: readonly PttGateOverride[]
  faults: readonly PttAuditFault[]
  /** Forensic audit of the re-scan; null / omitted on older scans. */
  verificationAudit?: Pick<
    PttVerificationAudit,
    "verdictHeadline" | "collateralDamageAnalysis"
  > | null
  /** Manager closure audit (CLOSED_ACCEPTED_RESIDUALS only). */
  closure?: { reasonLabel: string | null; note: string | null } | null
}

const STATUS_EMOJI: Record<PttCaseStatus, string> = {
  VERIFIED_CLOSED: "✅",
  CLOSED_ACCEPTED_RESIDUALS: "✅",
  PARTIAL_BLOCKED: "🟠",
  REJECTED_NO_PROGRESS: "⛔",
  REJECTED_INCOMPLETE: "⛔",
  OPEN: "🔵",
}

// Display order: what needs action first, good news last.
const BUCKET_SECTIONS: ReadonlyArray<{
  bucket: PttReconciliationBucket
  emoji: string
  title: string
}> = [
  { bucket: "NEW_REGRESSION", emoji: "🟠", title: "New Regressions (introduced)" },
  { bucket: "PERSISTING_OPEN", emoji: "🔴", title: "Still Open — Action Required" },
  { bucket: "PERSISTING_EXCEPTION", emoji: "⚪", title: "Persisting — Approved Exception" },
  { bucket: "NEW_EXCEPTION", emoji: "🔵", title: "New — Approved Exception" },
  { bucket: "CLEARED", emoji: "✅", title: "Cleared" },
]

const SEVERITY_SHORT: Record<PttFaultSeverity, string> = {
  CRITICAL: "Critical",
  CALIBRATION_ONLY: "Calibration",
  MONITOR: "Monitor",
  NEGLIGIBLE: "Negligible",
}

/**
 * Formats the closed-loop verification verdict for WhatsApp: case status, the
 * baseline − cleared + new = now equation, every bucket with its fault keys,
 * bounce-back flags and any manager gate overrides.
 */
export function formatPttVerificationAuditForWhatsApp(
  input: PttVerificationAuditInput
): string {
  const lines: string[] = []
  lines.push("*🔍 PTT BEFORE/AFTER VERIFICATION*")
  lines.push(`*Fleet ID:* ${input.fleetId}`)
  lines.push(`*Re-scan:* ${format(input.scannedAt, "dd MMM yyyy, HH:mm")}`)
  if (input.caseStatus === "CLOSED_ACCEPTED_RESIDUALS") {
    lines.push(
      `*Case Status:* ${STATUS_EMOJI[input.caseStatus]} CLOSED (Accepted Residuals)`
    )
    const reason = input.closure?.reasonLabel?.trim()
    const note = input.closure?.note?.trim()
    if (reason) lines.push(`*Closure reason:* ${reason}`)
    if (note) lines.push(`*Closure note:* ${note}`)
  } else {
    lines.push(
      `*Case Status:* ${STATUS_EMOJI[input.caseStatus]} ${PTT_CASE_STATUS_LABELS[input.caseStatus]}`
    )
  }

  const audit = input.verificationAudit
  if (audit?.verdictHeadline.trim()) {
    lines.push("")
    lines.push(`*Verdict:* ${audit.verdictHeadline.trim()}`)
  }
  if (audit?.collateralDamageAnalysis?.trim()) {
    lines.push("")
    lines.push("*⚠️ Collateral Damage Analysis:*")
    lines.push(audit.collateralDamageAnalysis.trim())
  }

  const { headerItemCount, extractedItemCount } = input
  if (headerItemCount !== null && extractedItemCount !== null) {
    lines.push(
      `*Faults read:* ${extractedItemCount} of ${headerItemCount} (PTT header count)`
    )
  }

  const summary = input.summary
  if (summary) {
    lines.push("")
    lines.push(
      `*Equation:* ${summary.baselineActiveCount} before − ${summary.clearedCount} cleared + ${summary.newRegressionCount} regression + ${summary.newExceptionCount} new exception = ${summary.verificationActiveCount} active now`
    )
    lines.push(
      `Still open: ${summary.persistingOpenCount} · Persisting exceptions: ${summary.persistingExceptionCount}`
    )
    if (summary.bounceBackCount > 0) {
      lines.push(
        `🔁 Bounce-backs (reappeared within 30 days): ${summary.bounceBackCount}`
      )
    }
  }

  for (const section of BUCKET_SECTIONS) {
    const faults = input.faults.filter(
      (fault) => fault.reconciliationBucket === section.bucket
    )
    if (faults.length === 0) continue
    lines.push("")
    lines.push(`*${section.title} (${faults.length}):*`)
    for (const fault of faults) {
      const description = fault.description.trim()
      const detail = [
        fault.ecuLabel.trim(),
        description,
        SEVERITY_SHORT[fault.severity],
      ]
        .filter(Boolean)
        .join(" — ")
      lines.push(
        `${section.emoji} \`${fault.canonicalKey}\` ${detail}${fault.isBounceBack ? " 🔁 BOUNCE-BACK" : ""}`
      )
    }
  }

  if (input.gateOverrides.length > 0) {
    lines.push("")
    lines.push("*⚠️ Manager overrides logged:*")
    for (const override of input.gateOverrides) {
      lines.push(`• ${override.gate}: ${override.reason.trim()}`)
    }
  }

  return lines.join("\n")
}
