"use client"

import { ClipboardCheckIcon, Loader2Icon } from "lucide-react"
import { useState } from "react"

import { closeCaseWithAcceptedResidualsAction } from "@/actions/ptt-diagnostics"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { normalizeFleetId, type PttTruckGeneration } from "@/lib/ptt-diagnostics"
import type { PttSessionWithRelations } from "@/lib/ptt-diagnostics-queries"
import {
  PTT_CLOSURE_NOTE_MIN_LENGTH,
  PTT_CLOSURE_REASON_CATEGORIES,
  PTT_CLOSURE_REASON_LABELS,
  type PttClosureReasonCategory,
  type PttExceptionScope,
} from "@/lib/ptt/constants"

const GENERATION_LABEL: Record<PttTruckGeneration, string> = {
  FH_V3: "FH V3",
  FH_V4: "FH V4",
  UNKNOWN: "unknown generation",
}

/** The residual keys the dialog lists (what the re-scan still shows open). */
function residualKeys(session: PttSessionWithRelations): string[] {
  const latest = session.verificationScans[0]
  if (latest) {
    return latest.scanFaults
      .filter(
        (fault) =>
          fault.reconciliationBucket === "NEW_REGRESSION" ||
          fault.reconciliationBucket === "PERSISTING_OPEN"
      )
      .map((fault) => fault.canonicalKey)
  }
  return session.faults
    .filter((fault) => fault.faultState !== "INACTIVE" && !fault.resolvedOnRescan)
    .map((fault) => `${fault.controlUnit.trim()} ${fault.faultCode.trim()}`)
}

/**
 * "Close Job (Accept Residuals)": a manager releases the case while known
 * residual faults remain, with a mandatory reason and note. Optionally the
 * residuals are saved as approved exceptions (truck-only or fleet-wide);
 * otherwise they stay OPEN in the truck ledger and in the reports.
 */
export function CloseJobDialog({
  open,
  session,
  onOpenChange,
  onClosed,
}: {
  open: boolean
  /** The case's baseline session. */
  session: PttSessionWithRelations
  onOpenChange: (open: boolean) => void
  onClosed: (session: PttSessionWithRelations) => void
}) {
  const generation = session.truckGeneration
  const fleetId = normalizeFleetId(session.fleetId)
  const fleetWideAllowed = generation !== "UNKNOWN"
  const residuals = residualKeys(session)

  const [reason, setReason] = useState<PttClosureReasonCategory | null>(null)
  const [note, setNote] = useState("")
  const [saveAsExceptions, setSaveAsExceptions] = useState(true)
  const [scope, setScope] = useState<PttExceptionScope>("TRUCK_SPECIFIC")
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  function reset() {
    setReason(null)
    setNote("")
    setSaveAsExceptions(true)
    setScope("TRUCK_SPECIFIC")
    setError(null)
  }

  async function handleClose() {
    if (!reason) {
      setError("Choose a closure reason.")
      return
    }
    if (note.trim().length < PTT_CLOSURE_NOTE_MIN_LENGTH) {
      setError(
        `Add a closure note (at least ${PTT_CLOSURE_NOTE_MIN_LENGTH} characters).`
      )
      return
    }

    setError(null)
    setIsSaving(true)
    try {
      const result = await closeCaseWithAcceptedResidualsAction({
        sessionId: session.id,
        closureReasonCategory: reason,
        closureNote: note.trim(),
        saveResidualsAsExceptions: saveAsExceptions,
        exceptionScope: scope,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      const { session: updated, savedAsExceptions, cascadedClosedCount } =
        result.data
      toast.add({
        title: `${fleetId} closed (accepted residuals)`,
        description: [
          savedAsExceptions
            ? "The residual faults were saved as approved exceptions."
            : "The residual faults stay open in the truck ledger.",
          cascadedClosedCount > 0
            ? `${cascadedClosedCount} other ${cascadedClosedCount === 1 ? "case" : "cases"} closed by the fleet-wide exception.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        type: "success",
      })
      onClosed(updated)
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Close Job (Accept Residuals)</DialogTitle>
          <DialogDescription>
            Release {fleetId} while the faults below stay as they are. The
            closure, who made it and why are logged on the case.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3">
            <span className="text-xs font-medium">
              Residual faults being accepted ({residuals.length})
            </span>
            {residuals.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                None - nothing is currently open on this case.
              </p>
            ) : (
              <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
                {residuals.map((key) => (
                  <li key={key}>
                    <code className="font-mono text-xs break-all">{key}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="closure-reason">Closure reason</Label>
            <Select
              value={reason}
              onValueChange={(value) => {
                const match = PTT_CLOSURE_REASON_CATEGORIES.find(
                  (category) => category === value
                )
                if (match) setReason(match)
              }}
              disabled={isSaving}
            >
              <SelectTrigger id="closure-reason" className="w-full">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent className="z-[60]">
                {PTT_CLOSURE_REASON_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {PTT_CLOSURE_REASON_LABELS[category]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="closure-note">Closure note</Label>
            <Textarea
              id="closure-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why is it acceptable to release this truck with these faults? (required)"
              rows={3}
              maxLength={2000}
              disabled={isSaving}
            />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="closure-save-exceptions">
                Save residuals as approved exceptions
              </Label>
              <p className="text-xs text-muted-foreground">
                On: the faults stop blocking and are excluded from the reports.
                Off: they stay OPEN in the ledger and keep showing as
                outstanding.
              </p>
            </div>
            <Switch
              id="closure-save-exceptions"
              checked={saveAsExceptions}
              onCheckedChange={setSaveAsExceptions}
              disabled={isSaving}
            />
          </div>

          {saveAsExceptions && (
            <div className="grid gap-1.5">
              <Label htmlFor="closure-scope">Exception applies to</Label>
              <Select
                value={scope}
                onValueChange={(value) => {
                  if (value === "TRUCK_SPECIFIC" || value === "FLEET_GENERATION") {
                    setScope(value)
                  }
                }}
                disabled={isSaving}
              >
                <SelectTrigger id="closure-scope" className="w-full">
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
            </div>
          )}

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
            disabled={isSaving}
            onClick={() => void handleClose()}
          >
            {isSaving ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <ClipboardCheckIcon data-icon="inline-start" />
            )}
            Close Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
