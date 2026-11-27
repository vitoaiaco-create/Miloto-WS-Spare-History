"use client"

import { Loader2Icon, ShieldCheckIcon } from "lucide-react"
import { useState } from "react"

import { approvePttExceptionsBatch } from "@/actions/ptt-diagnostics"
import { SeverityBadge } from "@/components/diagnostics/diagnostics-badges"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import type { PttTruckGeneration } from "@/lib/ptt-diagnostics"
import type {
  PttScanFaultRow,
  PttSessionWithRelations,
} from "@/lib/ptt-diagnostics-queries"
import {
  PTT_EXCEPTION_REASON_CATEGORIES,
  PTT_EXCEPTION_REASON_LABELS,
  type PttExceptionReasonCategory,
  type PttExceptionScope,
} from "@/lib/ptt/constants"

const MIN_PROOF_LENGTH = 10

const GENERATION_LABEL: Record<PttTruckGeneration, string> = {
  FH_V3: "FH V3",
  FH_V4: "FH V4",
  UNKNOWN: "unknown generation",
}

/**
 * "Batch Approve Remaining": one shared reason and physical-proof note for
 * every remaining open fault (Still Open + New Regressions) the manager leaves
 * ticked. The server action stores all exceptions and re-evaluates the case in
 * one atomic batch; a fleet-wide scope also re-checks the other open cases of
 * that generation.
 */
export function BatchApproveExceptionsDialog({
  open,
  faults,
  baselineId,
  fleetId,
  generation,
  onOpenChange,
  onApproved,
}: {
  open: boolean
  /** Still Open + New Regressions of the latest verification scan. */
  faults: readonly PttScanFaultRow[]
  /** The case's baseline scan id. */
  baselineId: number
  fleetId: string
  generation: PttTruckGeneration
  onOpenChange: (open: boolean) => void
  onApproved: (session: PttSessionWithRelations) => void
}) {
  // All faults start ticked: track only what the manager un-ticks.
  const [unticked, setUnticked] = useState<ReadonlySet<number>>(() => new Set())
  const [scope, setScope] = useState<PttExceptionScope>("TRUCK_SPECIFIC")
  const [reason, setReason] = useState<PttExceptionReasonCategory | null>(null)
  const [proof, setProof] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const fleetWideAllowed = generation !== "UNKNOWN"
  const selected = faults.filter((fault) => !unticked.has(fault.id))

  function reset() {
    setUnticked(new Set())
    setScope("TRUCK_SPECIFIC")
    setReason(null)
    setProof("")
    setError(null)
  }

  function toggle(faultId: number, checked: boolean) {
    setUnticked((current) => {
      const next = new Set(current)
      if (checked) next.delete(faultId)
      else next.add(faultId)
      return next
    })
  }

  async function handleApprove() {
    if (selected.length === 0) {
      setError("Select at least one fault.")
      return
    }
    if (!reason) {
      setError("Choose a reason category.")
      return
    }
    const note = proof.trim()
    if (note.length < MIN_PROOF_LENGTH) {
      setError(
        `Describe the physical proof (at least ${MIN_PROOF_LENGTH} characters).`
      )
      return
    }

    setError(null)
    setIsSaving(true)
    try {
      const result = await approvePttExceptionsBatch({
        sessionId: baselineId,
        canonicalKeys: selected.map((fault) => fault.canonicalKey),
        scope,
        reasonCategory: reason,
        physicalProofNote: note,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      const { session, approvedCount, cascadedClosedCount } = result.data
      toast.add({
        title: `${approvedCount} ${approvedCount === 1 ? "exception" : "exceptions"} approved`,
        description: [
          "The scan was re-evaluated.",
          cascadedClosedCount > 0
            ? `${cascadedClosedCount} other ${cascadedClosedCount === 1 ? "case" : "cases"} closed by this fleet-wide approval.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        type: "success",
      })
      onApproved(session)
      reset()
      onOpenChange(false)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (isSaving) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Batch Approve Remaining</DialogTitle>
          <DialogDescription>
            Approve every remaining open fault as a known, accepted condition
            with one shared reason and proof note. Each approval, who made it and
            the proof are logged.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label>
                Faults to approve ({selected.length} of {faults.length})
              </Label>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={isSaving}
                  onClick={() => setUnticked(new Set())}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={isSaving}
                  onClick={() =>
                    setUnticked(new Set(faults.map((fault) => fault.id)))
                  }
                >
                  Clear
                </Button>
              </div>
            </div>
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border p-1.5">
              {faults.map((fault) => (
                <li key={fault.id}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                    <Checkbox
                      className="mt-0.5"
                      checked={!unticked.has(fault.id)}
                      disabled={isSaving}
                      onCheckedChange={(checked) =>
                        toggle(fault.id, checked === true)
                      }
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <code className="font-mono text-xs font-semibold break-all">
                          {fault.canonicalKey}
                        </code>
                        <SeverityBadge severity={fault.severity} />
                        {fault.reconciliationBucket === "NEW_REGRESSION" && (
                          <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                            New regression
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fault.ecuLabel}
                        {fault.description.trim() &&
                          ` — ${fault.description.trim()}`}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="batch-exception-scope">Applies to</Label>
            <Select
              value={scope}
              onValueChange={(value) => {
                if (value === "TRUCK_SPECIFIC" || value === "FLEET_GENERATION") {
                  setScope(value)
                }
              }}
              disabled={isSaving}
            >
              <SelectTrigger id="batch-exception-scope" className="w-full">
                <SelectValue placeholder="Choose scope" />
              </SelectTrigger>
              <SelectContent className="z-[60]">
                <SelectItem value="TRUCK_SPECIFIC">
                  This truck only ({fleetId})
                </SelectItem>
                <SelectItem
                  value="FLEET_GENERATION"
                  disabled={!fleetWideAllowed}
                >
                  Fleet-Wide ({GENERATION_LABEL[generation]})
                </SelectItem>
              </SelectContent>
            </Select>
            {!fleetWideAllowed && (
              <p className="text-xs text-muted-foreground">
                Fleet-wide exceptions need a known truck generation.
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="batch-exception-reason">Reason category</Label>
            <Select
              value={reason}
              onValueChange={(value) => {
                const match = PTT_EXCEPTION_REASON_CATEGORIES.find(
                  (category) => category === value
                )
                if (match) setReason(match)
              }}
              disabled={isSaving}
            >
              <SelectTrigger id="batch-exception-reason" className="w-full">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent className="z-[60]">
                {PTT_EXCEPTION_REASON_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {PTT_EXCEPTION_REASON_LABELS[category]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="batch-exception-proof">
              Physical proof note (shared)
            </Label>
            <Textarea
              id="batch-exception-proof"
              value={proof}
              onChange={(event) => setProof(event.target.value)}
              placeholder="What did you physically see on the truck that confirms these are expected? (required)"
              rows={4}
              maxLength={2000}
              disabled={isSaving}
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={() => {
              reset()
              onOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSaving || selected.length === 0}
            onClick={() => void handleApprove()}
          >
            {isSaving ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <ShieldCheckIcon data-icon="inline-start" />
            )}
            Approve {selected.length} {selected.length === 1 ? "fault" : "faults"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
