"use client"

import {
  BadgeCheckIcon,
  CircleHelpIcon,
  ClipboardCheckIcon,
  RepeatIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"

import { SeverityBadge } from "@/components/diagnostics/diagnostics-badges"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { PttScanFaultRow } from "@/lib/ptt-diagnostics-queries"
import {
  PTT_CASE_STATUS_LABELS,
  type PttCaseStatus,
  type PttReconciliationBucket,
  type PttReconciliationSummary,
} from "@/lib/ptt/constants"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Case status banner
// ---------------------------------------------------------------------------

const CASE_STATUS_STYLE: Record<
  PttCaseStatus,
  { className: string; icon: LucideIcon }
> = {
  VERIFIED_CLOSED: { className: "bg-emerald-600", icon: BadgeCheckIcon },
  CLOSED_ACCEPTED_RESIDUALS: {
    className: "bg-teal-600",
    icon: ClipboardCheckIcon,
  },
  PARTIAL_BLOCKED: { className: "bg-amber-600", icon: TriangleAlertIcon },
  REJECTED_NO_PROGRESS: { className: "bg-red-600", icon: ShieldXIcon },
  REJECTED_INCOMPLETE: { className: "bg-red-600", icon: ShieldXIcon },
  OPEN: { className: "bg-sky-600", icon: CircleHelpIcon },
}

function caseStatusExplanation(
  status: PttCaseStatus,
  summary: PttReconciliationSummary | null
): string {
  switch (status) {
    case "VERIFIED_CLOSED":
      return "Every actionable fault is cleared and nothing new appeared."
    case "CLOSED_ACCEPTED_RESIDUALS":
      return "A manager closed this job and accepted the residual faults still shown by the re-scan."
    case "PARTIAL_BLOCKED": {
      const blocking =
        (summary?.persistingOpenCount ?? 0) + (summary?.newRegressionCount ?? 0)
      return `${blocking} actionable fault${blocking === 1 ? " is" : "s are"} still open or newly introduced. Rework or an approved exception is required before closure.`
    }
    case "REJECTED_NO_PROGRESS":
      return "No fault was cleared compared with the baseline. The repair made no measurable progress."
    case "REJECTED_INCOMPLETE":
      return "The re-scan was incomplete."
    case "OPEN":
      return "Waiting for the post-repair verification re-scan."
  }
}

/** The audit trail of a controlled closure, shown inside the banner. */
export type CaseClosureDetails = {
  reasonLabel: string | null
  note: string | null
  /** Already formatted for display. */
  closedAtLabel: string | null
}

export function CaseStatusBanner({
  status,
  summary,
  closure,
  actions,
}: {
  status: PttCaseStatus
  summary: PttReconciliationSummary | null
  closure?: CaseClosureDetails | null
  /** Buttons shown on the right (Close Job / Reopen Case). */
  actions?: ReactNode
}) {
  const { className, icon: Icon } = CASE_STATUS_STYLE[status]
  const showClosure = status === "CLOSED_ACCEPTED_RESIDUALS" && closure
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-lg px-4 py-3 text-white [&_svg]:mt-0.5 [&_svg]:size-5 [&_svg]:shrink-0",
        className
      )}
    >
      <Icon />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-bold tracking-wide uppercase">
          {PTT_CASE_STATUS_LABELS[status]}
        </span>
        <span className="text-sm opacity-95">
          {caseStatusExplanation(status, summary)}
        </span>
        {showClosure && (
          <dl className="mt-1 flex flex-col gap-0.5 text-sm">
            {closure.reasonLabel && (
              <div className="flex gap-1.5">
                <dt className="font-semibold">Reason:</dt>
                <dd>{closure.reasonLabel}</dd>
              </div>
            )}
            {closure.note && (
              <div className="flex gap-1.5">
                <dt className="font-semibold">Note:</dt>
                <dd className="break-words">{closure.note}</dd>
              </div>
            )}
            {closure.closedAtLabel && (
              <div className="flex gap-1.5">
                <dt className="font-semibold">Closed:</dt>
                <dd>{closure.closedAtLabel}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Equation strip: before - cleared + new = now
// ---------------------------------------------------------------------------

function Term({
  label,
  value,
  className,
}: {
  label: string
  value: number
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-w-20 flex-col items-center rounded-lg border px-3 py-1.5",
        className
      )}
    >
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-center text-[11px] leading-tight text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

function Operator({ children }: { children: string }) {
  return (
    <span aria-hidden className="text-lg font-semibold text-muted-foreground">
      {children}
    </span>
  )
}

export function EquationStrip({
  summary,
}: {
  summary: PttReconciliationSummary
}) {
  const balanced =
    summary.baselineActiveCount -
      summary.clearedCount +
      summary.newRegressionCount +
      summary.newExceptionCount ===
    summary.verificationActiveCount

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex flex-wrap items-center gap-2"
        aria-label={`${summary.baselineActiveCount} baseline faults minus ${summary.clearedCount} cleared plus ${summary.newRegressionCount} regressions plus ${summary.newExceptionCount} new exceptions equals ${summary.verificationActiveCount} active now`}
      >
        <Term label="Baseline active" value={summary.baselineActiveCount} />
        <Operator>−</Operator>
        <Term
          label="Cleared"
          value={summary.clearedCount}
          className="border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
        />
        <Operator>+</Operator>
        <Term
          label="New regressions"
          value={summary.newRegressionCount}
          className={
            summary.newRegressionCount > 0
              ? "border-amber-400 text-amber-700 dark:border-amber-700 dark:text-amber-300"
              : undefined
          }
        />
        <Operator>+</Operator>
        <Term
          label="New exceptions"
          value={summary.newExceptionCount}
          className="border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300"
        />
        <Operator>=</Operator>
        <Term
          label="Active now"
          value={summary.verificationActiveCount}
          className="bg-muted/50"
        />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Still open:{" "}
          <strong className="tabular-nums text-foreground">
            {summary.persistingOpenCount}
          </strong>
        </span>
        <span>
          Persisting exceptions:{" "}
          <strong className="tabular-nums text-foreground">
            {summary.persistingExceptionCount}
          </strong>
        </span>
        {summary.bounceBackCount > 0 && (
          <span className="font-medium text-red-600 dark:text-red-400">
            Bounce-backs: {summary.bounceBackCount}
          </span>
        )}
        {!balanced && (
          <span className="font-medium text-amber-700 dark:text-amber-300">
            Counts do not balance — review the key mapping below.
          </span>
        )}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Five buckets
// ---------------------------------------------------------------------------

const BUCKET_SECTIONS: ReadonlyArray<{
  bucket: PttReconciliationBucket
  title: string
  hint: string
  className: string
}> = [
  {
    bucket: "NEW_REGRESSION",
    title: "New Regressions",
    hint: "Introduced after the baseline and not approved. These block closure.",
    className: "border-amber-400/70 bg-amber-50/50 dark:bg-amber-950/20",
  },
  {
    bucket: "PERSISTING_OPEN",
    title: "Still Open — Action Required",
    hint: "On the baseline and still active. These block closure.",
    className: "border-red-400/70 bg-red-50/50 dark:bg-red-950/20",
  },
  {
    bucket: "PERSISTING_EXCEPTION",
    title: "Persisting — Approved Exception",
    hint: "Still active but covered by an approved exception.",
    className: "border-border bg-muted/30",
  },
  {
    bucket: "NEW_EXCEPTION",
    title: "New — Approved Exception",
    hint: "Appeared after the baseline but covered by an approved exception.",
    className: "border-sky-300/70 bg-sky-50/50 dark:bg-sky-950/20",
  },
  {
    bucket: "CLEARED",
    title: "Cleared",
    hint: "Active on the baseline, now gone or inactive.",
    className: "border-emerald-400/70 bg-emerald-50/50 dark:bg-emerald-950/20",
  },
]

function FaultRow({
  fault,
  onApprove,
}: {
  fault: PttScanFaultRow
  onApprove?: (fault: PttScanFaultRow) => void
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border bg-card px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <code className="font-mono text-xs font-semibold break-all">
            {fault.canonicalKey}
          </code>
          <SeverityBadge severity={fault.severity} />
          {fault.isBounceBack && (
            <Badge
              variant="outline"
              className="border-red-300 text-red-700 dark:border-red-800 dark:text-red-300"
              title="Cleared earlier, then reappeared within 30 days"
            >
              <RepeatIcon data-icon="inline-start" />
              Bounce-back
            </Badge>
          )}
          {fault.keyNeedsReview && (
            <Badge
              variant="outline"
              className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
              title={fault.keyReviewReason ?? "Fault key needs review"}
            >
              Key needs review
            </Badge>
          )}
          {!fault.isExtracted && (
            <Badge variant="outline" title="Not visible on the re-scan photos">
              Not on re-scan
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{fault.ecuLabel}</span>
          {fault.description.trim() && ` — ${fault.description.trim()}`}
        </p>
        {fault.keyNeedsReview && fault.keyReviewReason && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {fault.keyReviewReason}
          </p>
        )}
      </div>
      {onApprove && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onApprove(fault)}
        >
          <ShieldCheckIcon data-icon="inline-start" />
          Approve Exception
        </Button>
      )}
    </li>
  )
}

export function ReconciliationBuckets({
  faults,
  onApproveException,
}: {
  faults: readonly PttScanFaultRow[]
  /** Offered on "Still Open" and "New Regressions" rows. */
  onApproveException: (fault: PttScanFaultRow) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {BUCKET_SECTIONS.map((section) => {
        const rows = faults
          .filter((fault) => fault.reconciliationBucket === section.bucket)
          .sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey))
        return (
          <section
            key={section.bucket}
            className={cn("flex flex-col gap-2 rounded-xl border p-3", section.className)}
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h4 className="text-sm font-semibold">
                {section.title}{" "}
                <span className="tabular-nums text-muted-foreground">
                  ({rows.length})
                </span>
              </h4>
              <span className="text-xs text-muted-foreground">
                {section.hint}
              </span>
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {rows.map((fault) => (
                  <FaultRow
                    key={fault.id}
                    fault={fault}
                    onApprove={
                      section.bucket === "PERSISTING_OPEN" ||
                      section.bucket === "NEW_REGRESSION"
                        ? onApproveException
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
