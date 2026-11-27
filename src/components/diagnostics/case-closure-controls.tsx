"use client"

import { format } from "date-fns"
import { ClipboardCheckIcon, Loader2Icon, Undo2Icon } from "lucide-react"
import { useMemo, useState } from "react"

import { reopenPttCaseAction } from "@/actions/ptt-diagnostics"
import { CloseJobDialog } from "@/components/diagnostics/close-job-dialog"
import type { CaseClosureDetails } from "@/components/diagnostics/reconciliation-view"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { normalizeFleetId } from "@/lib/ptt-diagnostics"
import type {
  PttApprovedExceptionRow,
  PttSessionWithRelations,
} from "@/lib/ptt-diagnostics-queries"
import {
  CLOSE_JOB_ALREADY_CLOSED_MESSAGE,
  countActionableBaselineFaults,
  evaluateClosureEligibility,
  type ClosureEligibility,
} from "@/lib/ptt/closure-rules"
import { PTT_CLOSURE_REASON_LABELS } from "@/lib/ptt/constants"
import { matchesApprovedException } from "@/lib/ptt/reconcile"
import { canonicalKeyFor, toScanFaultStatus } from "@/lib/ptt/scan-faults"

/** Reason / note / timestamp of a case closed with accepted residuals. */
export function closureDetailsOf(
  session: PttSessionWithRelations
): CaseClosureDetails | null {
  if (session.caseStatus !== "CLOSED_ACCEPTED_RESIDUALS") return null
  return {
    reasonLabel: session.closureReasonCategory
      ? PTT_CLOSURE_REASON_LABELS[session.closureReasonCategory]
      : null,
    note: session.closureNote,
    closedAtLabel: session.closedAt
      ? format(session.closedAt, "dd MMM yyyy, HH:mm")
      : null,
  }
}

/**
 * Whether the case may be closed with accepted residuals. The Server Action
 * re-checks with the authoritative data; this only drives the button state.
 */
export function useClosureEligibility(
  session: PttSessionWithRelations,
  exceptions: readonly PttApprovedExceptionRow[]
): ClosureEligibility {
  return useMemo(() => {
    const generation = session.truckGeneration
    const fleetId = normalizeFleetId(session.fleetId)
    const baselineActionableCount = countActionableBaselineFaults(
      session.faults.map((fault) => {
        const canonicalKey = canonicalKeyFor(
          fault.controlUnit,
          fault.faultCode,
          generation
        )
        return {
          pttStatus: toScanFaultStatus(fault.faultState),
          severity: fault.severity,
          isApprovedException: matchesApprovedException(
            exceptions,
            fleetId,
            generation,
            canonicalKey
          ),
        }
      })
    )
    return evaluateClosureEligibility({
      caseStatus: session.caseStatus,
      hasVerificationScan: session.verificationScans.length > 0,
      baselineActionableCount,
    })
  }, [session, exceptions])
}

/** "Close Job (Accept Residuals)": the button plus its dialog. */
export function CloseJobButton({
  session,
  exceptions,
  onSessionUpdate,
  size = "sm",
  className,
}: {
  /** The case's baseline session. */
  session: PttSessionWithRelations
  exceptions: readonly PttApprovedExceptionRow[]
  onSessionUpdate: (session: PttSessionWithRelations) => void
  size?: "sm" | "default"
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const eligibility = useClosureEligibility(session, exceptions)

  // A closed case has nothing to close; hide rather than disable.
  if (
    !eligibility.allowed &&
    eligibility.reason === CLOSE_JOB_ALREADY_CLOSED_MESSAGE
  ) {
    return null
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant="outline"
        className={className}
        disabled={!eligibility.allowed}
        title={eligibility.allowed ? undefined : eligibility.reason}
        onClick={() => setOpen(true)}
      >
        <ClipboardCheckIcon data-icon="inline-start" />
        Close Job (Accept Residuals)
      </Button>
      {open && (
        <CloseJobDialog
          open={open}
          session={session}
          onOpenChange={setOpen}
          onClosed={onSessionUpdate}
        />
      )}
    </>
  )
}

/** Manager-only reopen of a case closed with accepted residuals. */
export function ReopenCaseButton({
  session,
  onSessionUpdate,
  size = "sm",
  className,
}: {
  session: PttSessionWithRelations
  onSessionUpdate: (session: PttSessionWithRelations) => void
  size?: "sm" | "default"
  className?: string
}) {
  const [isPending, setIsPending] = useState(false)

  if (session.caseStatus !== "CLOSED_ACCEPTED_RESIDUALS") return null

  async function reopen() {
    setIsPending(true)
    try {
      const result = await reopenPttCaseAction({ sessionId: session.id })
      if (!result.success) {
        toast.add({
          title: "Could not reopen the case",
          description: result.error,
          type: "error",
        })
        return
      }
      toast.add({
        title: "Case reopened",
        description:
          "The exceptions created by the closure were removed and the case was re-evaluated.",
        type: "success",
      })
      onSessionUpdate(result.data.session)
    } catch {
      toast.add({
        title: "Could not reopen the case",
        description: "Something went wrong. Please try again.",
        type: "error",
      })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      className={className}
      disabled={isPending}
      onClick={() => void reopen()}
    >
      {isPending ? (
        <Loader2Icon data-icon="inline-start" className="animate-spin" />
      ) : (
        <Undo2Icon data-icon="inline-start" />
      )}
      Reopen Case
    </Button>
  )
}
