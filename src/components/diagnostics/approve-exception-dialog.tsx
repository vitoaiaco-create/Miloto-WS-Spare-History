"use client"

import { Loader2Icon, ShieldCheckIcon } from "lucide-react"
import { useState } from "react"

import { approvePttException } from "@/actions/ptt-diagnostics"
import { SeverityBadge } from "@/components/diagnostics/diagnostics-badges"
import { Button } from "@/components/ui/button"
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
import { canonicalKeyFor } from "@/lib/ptt/scan-faults"

const MIN_PROOF_LENGTH = 10

const GENERATION_LABEL: Record<PttTruckGeneration, string> = {
  FH_V3: "FH V3",
  FH_V4: "FH V4",
  UNKNOWN: "unknown generation",
}

/**
 * Approve Exception modal for a fault that is still open after the repair.
 * The server action stores the exception, re-evaluates the verification scan
 * (buckets, equation, case status) and updates the truck ledger atomically.
 */
export function ApproveExceptionDialog({
  fault,
  baselineId,
  fleetId,
  generation,
  onOpenChange,
  onApproved,
}: {
  /** The open fault awaiting an exception. `null` keeps the dialog closed. */
  fault: PttScanFaultRow | null
  /** The case's baseline scan id. */
  baselineId: number
  fleetId: string
  generation: PttTruckGeneration
  onOpenChange: (open: boolean) => void
  onApproved: (session: PttSessionWithRelations) => void
}) {
  // Keep the last fault rendered while the close animation runs.
  const [shown, setShown] = useState<PttScanFaultRow | null>(fault)
  if (fault && fault !== shown) setShown(fault)

  const fleetWideAllowed = generation !== "UNKNOWN"
  const [scope, setScope] = useState<PttExceptionScope>("TRUCK_SPECIFIC")
  const [reason, setReason] = useState<PttExceptionReasonCategory | null>(null)
  const [proof, setProof] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  function reset() {
    setScope("TRUCK_SPECIFIC")
    setReason(null)
    setProof("")
    setError(null)
  }

  // An OCR-garbled `UNVERIFIED|...` row is saved under its repaired key.
  const savedKey = (row: PttScanFaultRow) =>
    row.canonicalKey.startsWith("UNVERIFIED|")
      ? canonicalKeyFor(row.ecuLabel, row.dtcRaw, generation)
      : row.canonicalKey

  async function handleApprove() {
    if (!fault) return
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
      const result = await approvePttException({
        sessionId: baselineId,
        canonicalKey: fault.canonicalKey,
        scope,
        reasonCategory: reason,
        physicalProofNote: note,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      const { session, cascadedClosedCount } = result.data
      toast.add({
        title: "Exception approved",
        description: [
          `${savedKey(fault)} no longer blocks closure. The scan was re-evaluated.`,
          cascadedClosedCount > 0
            ? `${cascadedClosedCount} other ${cascadedClosedCount === 1 ? "case" : "cases"} closed by this fleet-wide exception.`
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
      open={fault !== null}
      onOpenChange={(open) => {
        if (isSaving) return
        if (!open) reset()
        onOpenChange(open)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Approve Exception</DialogTitle>
          <DialogDescription>
            Mark this fault as a known, accepted condition so it stops blocking
            case closure. The approval, who made it and the physical proof are
            logged.
          </DialogDescription>
        </DialogHeader>

        {shown && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-mono text-xs font-semibold break-all">
                  {shown.canonicalKey}
                </code>
                <SeverityBadge severity={shown.severity} />
              </div>
              {savedKey(shown) !== shown.canonicalKey && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  The ECU was misread by OCR. The exception will be saved under{" "}
                  <code className="font-mono font-semibold">{savedKey(shown)}</code>.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {shown.ecuLabel}
                </span>
                {shown.description.trim() && ` — ${shown.description.trim()}`}
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="exception-scope">Applies to</Label>
              <Select
                value={scope}
                onValueChange={(value) => {
                  if (value === "TRUCK_SPECIFIC" || value === "FLEET_GENERATION") {
                    setScope(value)
                  }
                }}
                disabled={isSaving}
              >
                <SelectTrigger id="exception-scope" className="w-full">
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
                    All {GENERATION_LABEL[generation]} trucks (fleet-wide)
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
              <Label htmlFor="exception-reason">Reason category</Label>
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
                <SelectTrigger id="exception-reason" className="w-full">
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
              <Label htmlFor="exception-proof">Physical proof note</Label>
              <Textarea
                id="exception-proof"
                value={proof}
                onChange={(event) => setProof(event.target.value)}
                placeholder="What did you physically see on the truck that confirms this is expected? (required)"
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
        )}

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
            disabled={isSaving}
            onClick={() => void handleApprove()}
          >
            {isSaving ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <ShieldCheckIcon data-icon="inline-start" />
            )}
            Approve Exception
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
