"use client"

import { format } from "date-fns"
import { useRouter } from "next/navigation"
import {
  BadgeCheckIcon,
  CopyIcon,
  ImageIcon,
  ImagePlus,
  Loader2Icon,
  MessageCircleIcon,
  ScanSearchIcon,
  ShieldXIcon,
  TriangleAlertIcon,
  X,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react"

import {
  ACCEPT,
  COMPRESS_THRESHOLD_BYTES,
  compressImage,
  formatBytes,
  newId,
  normalizeFile,
  readApiResponse,
  revivePttSession,
} from "@/components/diagnostics/new-ptt-scan-panel"
import { ApproveExceptionDialog } from "@/components/diagnostics/approve-exception-dialog"
import {
  CaseStatusBanner,
  EquationStrip,
  ReconciliationBuckets,
} from "@/components/diagnostics/reconciliation-view"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  PTT_IMAGE_CONTENT_TYPES,
  PTT_IMAGE_MAX_BYTES,
  formatPttVerificationForWhatsApp,
  normalizeFleetId,
} from "@/lib/ptt-diagnostics"
import type {
  PttScanFaultRow,
  PttSessionWithRelations,
} from "@/lib/ptt-diagnostics-queries"
import { formatPttVerificationAuditForWhatsApp } from "@/lib/ptt/audit-format"
import type { PttGateName } from "@/lib/ptt/constants"
import type { PttVerificationAudit } from "@/lib/ptt/verification-audit-schema"
import { cn } from "@/lib/utils"

// Matches `MAX_VERIFICATION_ATTACHMENTS` in the verification route.
const MAX_PHOTOS = 10
// A manager override must carry a real explanation (it is logged).
const MIN_OVERRIDE_REASON_LENGTH = 10

type UploadedAttachment = {
  fileName: string
  blobPathname: string
  blobUrl: string
  contentType: string
  fileSize: number
}

// A verification request the server refused (gate failure, bad photos...).
class VerificationError extends Error {
  constructor(
    message: string,
    readonly code: string | null
  ) {
    super(message)
  }
}

type GateOverrideState = { enabled: boolean; reason: string }
const EMPTY_OVERRIDE: GateOverrideState = { enabled: false, reason: "" }

const GATE_OVERRIDE_COPY: Record<
  PttGateName,
  { label: string; hint: string }
> = {
  INCOMPLETE_SCAN: {
    label: "Override: accept this scan as complete",
    hint: "Only if the missing page(s) genuinely cannot be captured (e.g. the unit cannot scroll). The reason is logged against this scan.",
  },
  TRUCK_MISMATCH: {
    label: "Override: these photos are for this truck",
    hint: "Only if you have confirmed the Work Order / chassis on the unit belongs to this truck. The reason is logged against this scan.",
  },
}

type PhotoItem = {
  id: string
  file: File
  previewUrl: string
  /** True when the file was shrunk through the canvas pipeline. */
  compressed: boolean
}

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; current: number; total: number }
  | { kind: "verifying" }

// The verification route answers { success, data } or
// { success: false, error, code }; gateway failures may be plain text.
async function readVerificationResponse(response: Response): Promise<unknown> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // handled below
  }
  const parsed = body as {
    success?: boolean
    data?: unknown
    error?: string
    code?: string | null
  } | null
  if (!response.ok || !parsed?.success || parsed.data === undefined) {
    throw new VerificationError(
      parsed?.error ??
        (response.status === 504
          ? "The verification timed out. Please try again."
          : `Verification failed (HTTP ${response.status}).`),
      parsed?.code ?? null
    )
  }
  return parsed.data
}

function Panel({
  title,
  icon,
  children,
  className,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn("flex flex-col gap-3 rounded-xl border p-4", className)}
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function CodeBadges({
  title,
  codes,
  empty,
  className,
}: {
  title: string
  codes: string[]
  empty: string
  className?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title} <span className="tabular-nums">({codes.length})</span>
      </h4>
      {codes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {codes.map((code) => (
            <Badge
              key={code}
              variant="outline"
              className={cn("font-mono", className)}
            >
              {code}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function VerificationAuditCard({ session }: { session: PttSessionWithRelations }) {
  const verification = session.verificationSummary
  const message = useMemo(
    () => formatPttVerificationForWhatsApp(session),
    [session]
  )
  if (!verification) return null

  const passed = verification.verification_passed

  async function copyVerdict() {
    try {
      await navigator.clipboard.writeText(message)
      toast.add({
        title: "Copied for WhatsApp",
        description: "Paste the verdict into any WhatsApp chat.",
        type: "success",
      })
    } catch {
      toast.add({
        title: "Could not copy to clipboard",
        description: "Your browser blocked clipboard access.",
        type: "error",
      })
    }
  }

  function shareVerdict() {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer"
    )
  }

  return (
    <Panel
      title="Verification Audit"
      icon={<ScanSearchIcon />}
      className={cn(
        "border-2",
        passed
          ? "border-emerald-500/60 dark:border-emerald-700"
          : "border-red-500/60 dark:border-red-700"
      )}
    >
      <div
        role="status"
        className={cn(
          "flex items-center gap-3 rounded-lg px-4 py-3 text-base font-bold tracking-wide text-white uppercase [&_svg]:size-6 [&_svg]:shrink-0",
          passed ? "bg-emerald-600" : "bg-red-600"
        )}
      >
        {passed ? <BadgeCheckIcon /> : <ShieldXIcon />}
        {passed ? "VERIFIED PASSED" : "VERIFICATION FAILED — REWORK REQUIRED"}
      </div>

      {verification.summary.trim() && (
        <div className="flex flex-col gap-1">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Executive Summary
          </h4>
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {verification.summary.trim()}
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <CodeBadges
          title="Resolved Codes"
          codes={verification.resolved_fault_codes}
          empty="None."
          className="border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
        />
        <CodeBadges
          title="Still Active Codes"
          codes={verification.still_active_fault_codes}
          empty="None — nothing is still active."
          className="border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        />
        <CodeBadges
          title="Newly Introduced Codes"
          codes={verification.newly_introduced_fault_codes}
          empty="None."
          className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
        />
      </div>

      {verification.next_enforcement_action.trim() && (
        <div
          className={cn(
            "rounded-lg border p-3",
            passed
              ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
              : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
          )}
        >
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Next Enforcement Action
          </h4>
          <p className="mt-1 text-sm leading-relaxed font-medium whitespace-pre-line">
            {verification.next_enforcement_action.trim()}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {session.verifiedAt
            ? `Verified ${format(session.verifiedAt, "dd MMM yyyy, HH:mm")}`
            : `Last checked ${format(session.updatedAt, "dd MMM yyyy, HH:mm")}`}
          {verification.verified_by_model &&
            ` · ${verification.verified_by_model}`}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={copyVerdict}>
          <CopyIcon data-icon="inline-start" />
          Copy Verdict for WhatsApp
        </Button>
        <Button type="button" size="sm" onClick={shareVerdict}>
          <MessageCircleIcon data-icon="inline-start" />
          Share Verdict on WhatsApp
        </Button>
      </div>
    </Panel>
  )
}

function PostRepairScreenshots({
  session,
}: {
  session: PttSessionWithRelations
}) {
  // Re-scan photos live on each verification scan (legacy cases kept them on
  // the baseline with the VERIFICATION_SCAN role).
  const shots = [
    ...session.verificationScans.flatMap((scan) => scan.attachments),
    ...session.attachments.filter(
      (attachment) => attachment.role === "VERIFICATION_SCAN"
    ),
  ].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())

  return (
    <Panel
      title={`Post-Repair Screenshots (${shots.length})`}
      icon={<ImageIcon />}
    >
      {shots.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No post-repair screenshots have been uploaded for this scan yet.
        </p>
      ) : (
        <ul className="flex gap-3 overflow-x-auto pb-1">
          {shots.map((attachment) => (
            <li key={attachment.id} className="shrink-0">
              <a
                href={`/api/diagnostics/attachments/${attachment.id}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${attachment.fileName} in a new tab`}
                className="flex w-40 flex-col gap-1.5 rounded-lg border bg-card p-1.5 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- private blob streamed through an auth-guarded route */}
                <img
                  src={`/api/diagnostics/attachments/${attachment.id}`}
                  alt={attachment.fileName}
                  loading="lazy"
                  className="h-24 w-full rounded-md bg-muted object-cover"
                />
                <span className="truncate px-0.5 text-xs">
                  {attachment.fileName}
                </span>
                <span className="px-0.5 text-xs text-muted-foreground">
                  {format(attachment.uploadedAt, "dd MMM, HH:mm")}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function VerificationUploadForm({
  session,
  onVerified,
}: {
  session: PttSessionWithRelations
  onVerified: (session: PttSessionWithRelations) => void
}) {
  const router = useRouter()
  const [items, setItems] = useState<PhotoItem[]>([])
  const [processing, setProcessing] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Source of truth for the selected photos so concurrent additions never
  // read a stale list.
  const itemsRef = useRef<PhotoItem[]>([])
  const addQueueRef = useRef<Promise<void>>(Promise.resolve())
  // Photo id -> already uploaded blob, so a retry after a failed upload
  // doesn't upload it twice. Cleared whenever the server rejects the request
  // (it deletes its temporary uploads on every failure).
  const uploadedRef = useRef(new Map<string, UploadedAttachment>())
  // Integrity gates the server refused; each offers a manager override.
  const [blockedGates, setBlockedGates] = useState<ReadonlySet<PttGateName>>(
    () => new Set()
  )
  const [overrides, setOverrides] = useState<
    Record<PttGateName, GateOverrideState>
  >({ INCOMPLETE_SCAN: EMPTY_OVERRIDE, TRUCK_MISMATCH: EMPTY_OVERRIDE })

  const busy = phase.kind !== "idle"
  const fleetId = normalizeFleetId(session.fleetId)

  useEffect(
    () => () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl)
    },
    []
  )

  const commitItems = useCallback((next: PhotoItem[]) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      // Serialised so rapid drops / pastes can't overshoot the photo cap.
      addQueueRef.current = addQueueRef.current.then(async () => {
        setProcessing((n) => n + 1)
        try {
          const added: PhotoItem[] = []
          let overflow = 0
          for (const original of files) {
            if (
              !(PTT_IMAGE_CONTENT_TYPES as readonly string[]).includes(
                original.type
              )
            ) {
              toast.add({
                title: "Unsupported file",
                description: `"${original.name || "Pasted item"}" is not allowed. Use JPG, PNG or WEBP images.`,
                type: "error",
              })
              continue
            }
            if (itemsRef.current.length + added.length >= MAX_PHOTOS) {
              overflow += 1
              continue
            }

            const normalized = normalizeFile(original)
            const isCompressed = normalized.size > COMPRESS_THRESHOLD_BYTES
            const prepared = isCompressed
              ? await compressImage(normalized)
              : normalized

            if (prepared.size === 0) {
              toast.add({
                title: "Empty file",
                description: `"${prepared.name}" is empty.`,
                type: "error",
              })
              continue
            }
            if (prepared.size > PTT_IMAGE_MAX_BYTES) {
              toast.add({
                title: "Photo too large",
                description: `"${prepared.name}" is still ${formatBytes(prepared.size)} after compression. The limit is 4.5 MB.`,
                type: "error",
              })
              continue
            }

            added.push({
              id: newId(),
              file: prepared,
              previewUrl: URL.createObjectURL(prepared),
              compressed: prepared !== normalized,
            })
          }

          if (overflow > 0) {
            toast.add({
              title: `Maximum ${MAX_PHOTOS} photos`,
              description: `${overflow} photo${overflow === 1 ? " was" : "s were"} not added.`,
              type: "warning",
            })
          }
          if (added.length > 0) {
            commitItems([...itemsRef.current, ...added])
            setError(null)
          }
        } finally {
          setProcessing((n) => n - 1)
        }
      })
    },
    [commitItems]
  )

  function removeItem(id: string) {
    const removed = itemsRef.current.find((item) => item.id === id)
    if (removed) URL.revokeObjectURL(removed.previewUrl)
    uploadedRef.current.delete(id)
    commitItems(itemsRef.current.filter((item) => item.id !== id))
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (busy) return
    const images = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/")
    )
    if (images.length === 0) return
    event.preventDefault()
    addFiles(images)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    if (busy) return
    addFiles(Array.from(event.dataTransfer.files))
  }

  function handleDropzoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      fileInputRef.current?.click()
    }
  }

  async function uploadPhoto(item: PhotoItem): Promise<UploadedAttachment> {
    const cached = uploadedRef.current.get(item.id)
    if (cached) return cached

    // No session id: the file is a temporary upload that the verification
    // route either archives on success or deletes on failure.
    const formData = new FormData()
    formData.append("file", item.file)
    formData.append("fleetId", fleetId)
    const response = await fetch("/api/diagnostics/upload", {
      method: "POST",
      body: formData,
    })
    const attachment = await readApiResponse<UploadedAttachment>(
      response,
      `Could not upload "${item.file.name}"`
    )
    uploadedRef.current.set(item.id, attachment)
    return attachment
  }

  function setOverride(gate: PttGateName, next: Partial<GateOverrideState>) {
    setOverrides((current) => ({
      ...current,
      [gate]: { ...current[gate], ...next },
    }))
  }

  // The reason to send for a gate, or null when that override is off.
  function overrideReason(gate: PttGateName): string | null {
    const state = overrides[gate]
    return blockedGates.has(gate) && state.enabled ? state.reason.trim() : null
  }

  async function runVerification() {
    if (busy) return
    const photos = itemsRef.current
    if (photos.length === 0) {
      setError("Add at least one post-repair PTT photo.")
      return
    }

    // Enabled overrides must carry a real reason (it is logged server-side).
    for (const gate of blockedGates) {
      const reason = overrideReason(gate)
      if (reason !== null && reason.length < MIN_OVERRIDE_REASON_LENGTH) {
        setError(
          `Enter a reason of at least ${MIN_OVERRIDE_REASON_LENGTH} characters for the override, or untick it.`
        )
        return
      }
    }

    setError(null)
    try {
      const attachments: UploadedAttachment[] = []
      for (const [index, item] of photos.entries()) {
        setPhase({ kind: "uploading", current: index + 1, total: photos.length })
        attachments.push(await uploadPhoto(item))
      }

      setPhase({ kind: "verifying" })
      let updated: PttSessionWithRelations
      try {
        const response = await fetch(
          `/api/diagnostics/sessions/${session.id}/verification`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attachments,
              incompleteScanOverrideReason: overrideReason("INCOMPLETE_SCAN"),
              truckMismatchOverrideReason: overrideReason("TRUCK_MISMATCH"),
            }),
          }
        )
        updated = revivePttSession(await readVerificationResponse(response))
      } catch (verificationError) {
        // The server deletes its temporary uploads on every failure, so they
        // can't be reused. The local files stay selected for a retry.
        uploadedRef.current.clear()
        if (verificationError instanceof VerificationError) {
          if (verificationError.code === "INCOMPLETE_SCAN") {
            setBlockedGates((gates) => new Set(gates).add("INCOMPLETE_SCAN"))
          } else if (verificationError.code === "TRUCK_MISMATCH") {
            setBlockedGates((gates) => new Set(gates).add("TRUCK_MISMATCH"))
          }
        }
        throw verificationError
      }

      // Success: clear the form and show the reconciliation straight away.
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl)
      uploadedRef.current.clear()
      commitItems([])
      setBlockedGates(new Set())
      setOverrides({ INCOMPLETE_SCAN: EMPTY_OVERRIDE, TRUCK_MISMATCH: EMPTY_OVERRIDE })
      onVerified(updated)

      const closed = updated.caseStatus === "VERIFIED_CLOSED"
      toast.add({
        title: closed
          ? `${fleetId} VERIFIED CLOSED`
          : `${fleetId} re-scan reconciled`,
        description: closed
          ? "All actionable faults are cleared. The case is closed."
          : "Faults are still open — see the reconciliation for what remains.",
        type: closed ? "success" : "warning",
      })
      router.refresh()
    } catch (verifyError) {
      const message =
        verifyError instanceof Error
          ? verifyError.message
          : "Something went wrong. Please try again."
      setError(message)
      toast.add({
        title: "Verification failed",
        description: `${message} Your photos are still selected — fix the issue and run the verification again.`,
        type: "error",
      })
    } finally {
      setPhase({ kind: "idle" })
    }
  }

  const progressLabel =
    phase.kind === "uploading"
      ? `Uploading photo ${phase.current} of ${phase.total}...`
      : phase.kind === "verifying"
        ? "Reading the re-scan and reconciling Before vs. After..."
        : null
  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0)

  return (
    <Panel
      title="Upload Verification Re-Scan"
      icon={<ScanSearchIcon />}
    >
      <div
        className="flex flex-col gap-3"
        onPaste={handlePaste}
      >
        <p className="text-sm text-muted-foreground">
          After the repair, re-scan {fleetId} and upload every scroll page of
          the new PTT DTC List (or VCADS result). The faults are read from the
          photos and diffed against the baseline fault list by exact fault
          key. Recycled photos, incomplete scans and photos from another truck
          are rejected.
        </p>

        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Post-Repair Photos</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {items.length} / {MAX_PHOTOS} photos
            {items.length > 0 && ` · ${formatBytes(totalBytes)}`}
          </span>
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label="Add post-repair photos: drop files, click to browse, or paste a screenshot"
          aria-disabled={busy}
          onClick={() => !busy && fileInputRef.current?.click()}
          onKeyDown={handleDropzoneKeyDown}
          onDragOver={(event) => {
            event.preventDefault()
            if (!busy) setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            isDragging ? "border-primary bg-primary/5" : "hover:bg-muted/50",
            busy && "pointer-events-none opacity-60"
          )}
        >
          {processing > 0 ? (
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          ) : (
            <ImagePlus
              className="size-6 text-muted-foreground"
              strokeWidth={1.75}
            />
          )}
          <p className="text-sm font-medium">
            {processing > 0
              ? "Preparing photos..."
              : "Drop re-scan photos here, click to browse, or press Ctrl+V to paste"}
          </p>
          <p className="text-xs text-muted-foreground">
            JPG, PNG or WEBP · up to {MAX_PHOTOS} photos
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []))
            // Allow re-selecting the same file after removing it.
            event.target.value = ""
          }}
        />

        {items.length > 0 && (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-lg border bg-card p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview */}
                <img
                  src={item.previewUrl}
                  alt={item.file.name}
                  className="size-14 shrink-0 rounded-md border object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium"
                    title={item.file.name}
                  >
                    {item.file.name}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatBytes(item.file.size)}
                    {item.compressed && " · compressed"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${item.file.name}`}
                  disabled={busy}
                  onClick={() => removeItem(item.id)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Verification could not be completed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {[...blockedGates].map((gate) => {
          const state = overrides[gate]
          const copy = GATE_OVERRIDE_COPY[gate]
          return (
            <div
              key={gate}
              className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30"
            >
              <div className="flex items-start gap-2">
                <Checkbox
                  id={`override-${gate}`}
                  checked={state.enabled}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    setOverride(gate, { enabled: checked === true })
                  }
                />
                <div className="grid gap-0.5">
                  <Label htmlFor={`override-${gate}`}>{copy.label}</Label>
                  <p className="text-xs text-muted-foreground">{copy.hint}</p>
                </div>
              </div>
              {state.enabled && (
                <Textarea
                  aria-label={`${copy.label}: reason`}
                  value={state.reason}
                  onChange={(event) =>
                    setOverride(gate, { reason: event.target.value })
                  }
                  placeholder="Reason for the override (required, logged)"
                  rows={2}
                  maxLength={1000}
                  disabled={busy}
                />
              )}
            </div>
          )
        })}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={busy || processing > 0 || items.length === 0}
            onClick={() => void runVerification()}
          >
            {busy ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <ScanSearchIcon data-icon="inline-start" />
            )}
            {busy ? "Working..." : "Run Before/After Verification"}
          </Button>
          {progressLabel && (
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-muted-foreground"
            >
              {progressLabel}
            </p>
          )}
        </div>
      </div>
    </Panel>
  )
}

function AuditSection({
  title,
  className,
  children,
}: {
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      {children}
    </div>
  )
}

/**
 * Forensic VERIFICATION_AUDIT of the latest re-scan. Older scans (and scans
 * whose audit call failed) have no audit: a muted note is shown instead.
 */
function ForensicAuditCard({ audit }: { audit: PttVerificationAudit | null }) {
  if (!audit) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        No forensic audit is available for this re-scan. The reconciliation
        below is unaffected.
      </p>
    )
  }

  return (
    <section
      aria-label="Forensic verification audit"
      className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4"
    >
      <h4 className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4">
        <ScanSearchIcon />
        Forensic Audit
      </h4>
      <p className="text-sm leading-relaxed font-medium">
        {audit.verdictHeadline}
      </p>

      {audit.collateralDamageAnalysis && (
        <AuditSection
          title="Collateral damage analysis"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30"
        >
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {audit.collateralDamageAnalysis}
          </p>
        </AuditSection>
      )}

      {audit.untouchedBlockersSummary && (
        <AuditSection title="Untouched blockers">
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {audit.untouchedBlockersSummary}
          </p>
        </AuditSection>
      )}

      {audit.repeatFaultEscalation && (
        <AuditSection
          title="Repeat fault escalation"
          className="rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30"
        >
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {audit.repeatFaultEscalation}
          </p>
        </AuditSection>
      )}

      {audit.nextFloorActions.length > 0 && (
        <AuditSection title="Next floor actions">
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm leading-relaxed marker:text-muted-foreground">
            {audit.nextFloorActions.map((action, index) => (
              <li key={`${index}-${action}`}>{action}</li>
            ))}
          </ol>
        </AuditSection>
      )}
    </section>
  )
}

function ReconciliationPanel({
  session,
  onSessionUpdate,
}: {
  session: PttSessionWithRelations
  onSessionUpdate: (session: PttSessionWithRelations) => void
}) {
  const latest = session.verificationScans[0]
  const [approving, setApproving] = useState<PttScanFaultRow | null>(null)

  const message = useMemo(
    () =>
      latest
        ? formatPttVerificationAuditForWhatsApp({
            fleetId: normalizeFleetId(session.fleetId),
            caseStatus: session.caseStatus,
            scannedAt: latest.scannedAt,
            summary: latest.reconciliationSummary,
            headerItemCount: latest.headerItemCount,
            extractedItemCount: latest.extractedItemCount,
            gateOverrides: latest.gateOverrides,
            faults: latest.scanFaults,
            verificationAudit: latest.verificationAudit,
          })
        : "",
    [session.fleetId, session.caseStatus, latest]
  )

  if (!latest) return null
  const summary = latest.reconciliationSummary

  async function copyAudit() {
    try {
      await navigator.clipboard.writeText(message)
      toast.add({
        title: "Copied for WhatsApp",
        description: "Paste the verification audit into any WhatsApp chat.",
        type: "success",
      })
    } catch {
      toast.add({
        title: "Could not copy to clipboard",
        description: "Your browser blocked clipboard access.",
        type: "error",
      })
    }
  }

  function shareAudit() {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer"
    )
  }

  return (
    <Panel
      title="Before / After Reconciliation"
      icon={<ScanSearchIcon />}
      className="border-2"
    >
      <CaseStatusBanner status={session.caseStatus} summary={summary} />

      {summary && <EquationStrip summary={summary} />}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Re-scan {format(latest.scannedAt, "dd MMM yyyy, HH:mm")}
          {session.verificationScans.length > 1 &&
            ` · latest of ${session.verificationScans.length} re-scans`}
        </span>
        {latest.headerItemCount !== null && (
          <span className="tabular-nums">
            Faults read: {latest.extractedItemCount ?? 0} of{" "}
            {latest.headerItemCount} (PTT header count)
          </span>
        )}
      </div>

      {latest.gateOverrides.length > 0 && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Manager override logged</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {latest.gateOverrides.map((override) => (
                <li key={`${override.gate}-${override.at}`}>
                  <strong>{override.gate}</strong>: {override.reason}{" "}
                  <span className="text-muted-foreground">
                    ({format(new Date(override.at), "dd MMM yyyy, HH:mm")})
                  </span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <ForensicAuditCard audit={latest.verificationAudit} />

      <ReconciliationBuckets
        faults={latest.scanFaults}
        onApproveException={setApproving}
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copyAudit}>
          <CopyIcon data-icon="inline-start" />
          Copy Audit for WhatsApp
        </Button>
        <Button type="button" size="sm" onClick={shareAudit}>
          <MessageCircleIcon data-icon="inline-start" />
          Share Audit on WhatsApp
        </Button>
      </div>

      <ApproveExceptionDialog
        fault={approving}
        baselineId={session.id}
        fleetId={normalizeFleetId(session.fleetId)}
        generation={session.truckGeneration}
        onOpenChange={(open) => {
          if (!open) setApproving(null)
        }}
        onApproved={onSessionUpdate}
      />
    </Panel>
  )
}

/**
 * Closed-loop Before/After verification for the directive modal's
 * `verificationSlot`: the 5-bucket reconciliation (with exception approval),
 * post-repair screenshots and the re-scan upload form.
 */
export function PttVerificationSection({
  session,
  onSessionUpdate,
}: {
  session: PttSessionWithRelations
  /** Called with the refreshed session so the UI updates immediately. */
  onSessionUpdate: (session: PttSessionWithRelations) => void
}) {
  const hasReconciliation = session.verificationScans.length > 0
  const closed = session.caseStatus === "VERIFIED_CLOSED"

  return (
    <div className="flex flex-col gap-4">
      {hasReconciliation ? (
        <ReconciliationPanel
          session={session}
          onSessionUpdate={onSessionUpdate}
        />
      ) : session.verificationSummary ? (
        // Cases verified by the earlier AI comparison keep their audit card.
        <VerificationAuditCard session={session} />
      ) : null}
      <PostRepairScreenshots session={session} />
      {closed ? (
        <p className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
          This case is <strong>VERIFIED CLOSED</strong>. To track further work
          on this truck, start a new baseline scan.
        </p>
      ) : (
        <VerificationUploadForm session={session} onVerified={onSessionUpdate} />
      )}
    </div>
  )
}
