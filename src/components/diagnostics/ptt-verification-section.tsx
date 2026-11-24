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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import {
  PTT_IMAGE_CONTENT_TYPES,
  PTT_IMAGE_MAX_BYTES,
  formatPttVerificationForWhatsApp,
  normalizeFleetId,
} from "@/lib/ptt-diagnostics"
import type { PttSessionWithRelations } from "@/lib/ptt-diagnostics-queries"
import { cn } from "@/lib/utils"

// Matches `MAX_VERIFICATION_ATTACHMENTS` in the verify route.
const MAX_PHOTOS = 10

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
  const shots = session.attachments.filter(
    (attachment) => attachment.role === "VERIFICATION_SCAN"
  )

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
  // Photo id -> attachment id of an already uploaded photo, so a retry after
  // a failed verification doesn't upload (and archive) it twice.
  const uploadedRef = useRef(new Map<string, number>())

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

  async function uploadPhoto(item: PhotoItem): Promise<number> {
    const cached = uploadedRef.current.get(item.id)
    if (cached !== undefined) return cached

    const formData = new FormData()
    formData.append("file", item.file)
    formData.append("fleetId", fleetId)
    formData.append("sessionId", String(session.id))
    formData.append("role", "VERIFICATION_SCAN")
    const response = await fetch("/api/diagnostics/upload", {
      method: "POST",
      body: formData,
    })
    const attachment = await readApiResponse<{ id: number }>(
      response,
      `Could not upload "${item.file.name}"`
    )
    uploadedRef.current.set(item.id, attachment.id)
    return attachment.id
  }

  async function runVerification() {
    if (busy) return
    const photos = itemsRef.current
    if (photos.length === 0) {
      setError("Add at least one post-repair PTT photo.")
      return
    }

    setError(null)
    let uploadedSome = false
    try {
      const attachmentIds: number[] = []
      for (const [index, item] of photos.entries()) {
        setPhase({ kind: "uploading", current: index + 1, total: photos.length })
        attachmentIds.push(await uploadPhoto(item))
        uploadedSome = true
      }

      setPhase({ kind: "verifying" })
      const response = await fetch(
        `/api/diagnostics/sessions/${session.id}/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attachmentIds }),
        }
      )
      const updated = revivePttSession(
        await readApiResponse<unknown>(response, "Verification failed")
      )

      // Success: clear the form and show the verdict straight away.
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl)
      uploadedRef.current.clear()
      commitItems([])
      onVerified(updated)

      const passed = updated.verificationSummary?.verification_passed === true
      toast.add({
        title: passed
          ? `${fleetId} VERIFIED PASSED`
          : `${fleetId} verification failed`,
        description: passed
          ? "All critical and calibration faults are cleared. The scan is closed."
          : "Faults are still active — rework is required.",
        type: passed ? "success" : "warning",
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
        description: `${message} Your photos are still selected — click Run Before/After Verification to retry.`,
        type: "error",
      })
      // Uploaded photos are archived on the session; surface them.
      if (uploadedSome) router.refresh()
    } finally {
      setPhase({ kind: "idle" })
    }
  }

  const progressLabel =
    phase.kind === "uploading"
      ? `Uploading photo ${phase.current} of ${phase.total}...`
      : phase.kind === "verifying"
        ? "Comparing Before vs. After with Volvo Master AI..."
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
          After the repair, re-scan {fleetId} and upload the new PTT DTC List
          (or VCADS result) photos. The AI compares them with the original
          fault list and verification criteria.
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

/**
 * Before/After Re-Scan Verification for the directive modal's
 * `verificationSlot`: audit card, post-repair screenshots and the re-scan
 * upload form.
 */
export function PttVerificationSection({
  session,
  onSessionUpdate,
}: {
  session: PttSessionWithRelations
  /** Called with the freshly verified session so the UI updates immediately. */
  onSessionUpdate: (session: PttSessionWithRelations) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {session.verificationSummary && <VerificationAuditCard session={session} />}
      <PostRepairScreenshots session={session} />
      <VerificationUploadForm session={session} onVerified={onSessionUpdate} />
    </div>
  )
}