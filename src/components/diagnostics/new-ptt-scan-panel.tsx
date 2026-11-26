"use client"

import { format } from "date-fns"
import {
  ImagePlus,
  Loader2Icon,
  ScanLine,
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
} from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  PTT_IMAGE_CONTENT_TYPES,
  PTT_IMAGE_MAX_BYTES,
  normalizeFleetId,
  type PttTruckGeneration,
} from "@/lib/ptt-diagnostics"
import type { PttSessionWithRelations } from "@/lib/ptt-diagnostics-queries"
import { cn } from "@/lib/utils"

// Matches `MAX_ATTACHMENTS` in `/api/diagnostics/analyze`.
const MAX_PHOTOS = 10
// Images at or below this size are uploaded untouched so WhatsApp-compressed
// photos stay razor sharp for OCR. Larger (raw smartphone) photos are shrunk.
export const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024
const COMPRESS_MAX_DIMENSION = 2200
const COMPRESS_QUALITY = 0.85
export const ACCEPT = PTT_IMAGE_CONTENT_TYPES.join(",")

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
}

const GENERATION_OPTIONS: { value: PttTruckGeneration; label: string }[] = [
  { value: "UNKNOWN", label: "Auto-Detect" },
  { value: "FH_V3", label: "FH V3" },
  { value: "FH_V4", label: "FH V4" },
]

type PhotoItem = {
  id: string
  file: File
  previewUrl: string
  /** True when the file was shrunk through the canvas pipeline. */
  compressed: boolean
}

type UploadedAttachment = {
  fileName: string
  blobPathname: string
  blobUrl: string
  contentType: string
  fileSize: number
}

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; current: number; total: number }
  | { kind: "analyzing" }

export class ScanError extends Error {}

function defaultBatchLabel() {
  return `${format(new Date(), "MMM yyyy")} Fleet Sweep`
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function withExtension(name: string, extension: string) {
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  return `${stem || "screenshot"}${extension}`
}

// Pasted screenshots often arrive as `image.png` (or with no name at all) and
// the upload route requires the extension to match the MIME type.
export function normalizeFile(file: File): File {
  const extension = EXTENSION_BY_TYPE[file.type]
  const lower = file.name.toLowerCase()
  const extensionOk =
    file.type === "image/jpeg"
      ? lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      : lower.endsWith(extension)
  if (file.name && extensionOk) return file

  const base = file.name
    ? withExtension(file.name, extension)
    : `pasted-${format(new Date(), "yyyyMMdd-HHmmss")}${extension}`
  return new File([file], base, {
    type: file.type,
    lastModified: file.lastModified,
  })
}

// Downscales (max 2200px longest side) and re-encodes as JPEG 0.85. Falls
// back to the original file when decoding fails or nothing was saved.
export async function compressImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const scale = Math.min(
        1,
        COMPRESS_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height)
      )
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))

      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")
      if (!context) return file
      // JPEG has no alpha channel; avoid black backgrounds from PNG / WEBP.
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, width, height)
      context.drawImage(bitmap, 0, 0, width, height)

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", COMPRESS_QUALITY)
      )
      if (!blob || blob.size >= file.size) return file

      return new File([blob], withExtension(file.name, ".jpg"), {
        type: "image/jpeg",
        lastModified: file.lastModified,
      })
    } finally {
      bitmap.close()
    }
  } catch {
    return file
  }
}

// The analyze route answers with JSON, but gateway failures (413 / 504) can
// come back as plain text.
export async function readApiResponse<T>(
  response: Response,
  fallbackMessage: string
): Promise<T> {
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // handled below
  }
  const parsed = body as
    | { success?: boolean; data?: T; error?: string }
    | null
  if (!response.ok || !parsed?.success || parsed.data === undefined) {
    const detail = parsed?.error
    throw new ScanError(
      detail ??
        (response.status === 413
          ? "A photo is too large for the server (4.5 MB max)."
          : response.status === 504
            ? "The analysis timed out. Please try again."
            : `${fallbackMessage} (HTTP ${response.status}).`)
    )
  }
  return parsed.data
}

function toDate(value: unknown): Date | null {
  return typeof value === "string" || typeof value === "number"
    ? new Date(value)
    : null
}

function reviveAttachments(attachments: Record<string, unknown>[]) {
  return attachments.map((attachment) => ({
    ...attachment,
    uploadedAt: toDate(attachment.uploadedAt) ?? new Date(),
  }))
}

// JSON turns Date columns into ISO strings; the dashboard expects real Dates.
export function revivePttSession(data: unknown): PttSessionWithRelations {
  const raw = data as Record<string, unknown>
  if (
    typeof raw?.id !== "number" ||
    !Array.isArray(raw.faults) ||
    !Array.isArray(raw.attachments)
  ) {
    throw new ScanError("The server returned an unexpected scan result.")
  }
  return {
    ...raw,
    scannedAt: toDate(raw.scannedAt) ?? new Date(),
    updatedAt: toDate(raw.updatedAt) ?? new Date(),
    verifiedAt: toDate(raw.verifiedAt),
    faults: (raw.faults as Record<string, unknown>[]).map((fault) => ({
      ...fault,
      createdAt: toDate(fault.createdAt) ?? new Date(),
    })),
    attachments: reviveAttachments(raw.attachments as Record<string, unknown>[]),
    verificationScans: (
      (Array.isArray(raw.verificationScans) ? raw.verificationScans : []) as Record<
        string,
        unknown
      >[]
    ).map((scan) => ({
      ...scan,
      scannedAt: toDate(scan.scannedAt) ?? new Date(),
      updatedAt: toDate(scan.updatedAt) ?? new Date(),
      verifiedAt: toDate(scan.verifiedAt),
      scanFaults: (
        (Array.isArray(scan.scanFaults) ? scan.scanFaults : []) as Record<
          string,
          unknown
        >[]
      ).map((fault) => ({
        ...fault,
        createdAt: toDate(fault.createdAt) ?? new Date(),
      })),
      attachments: reviveAttachments(
        (Array.isArray(scan.attachments) ? scan.attachments : []) as Record<
          string,
          unknown
        >[]
      ),
    })),
  } as unknown as PttSessionWithRelations
}

export function NewPttScanPanel({
  initialFleetId,
  syncToken,
  rosterFleetIds,
  onScanComplete,
}: {
  /** Pre-selects a truck, e.g. from "Scan Truck" in Fleet Coverage. */
  initialFleetId?: string | null
  /**
   * Bump to re-apply `initialFleetId` even when it didn't change (e.g. the
   * same truck's "Scan Truck" button was clicked again).
   */
  syncToken?: number
  rosterFleetIds: string[]
  onScanComplete: (session: PttSessionWithRelations) => void
}) {
  const [fleetId, setFleetId] = useState(() =>
    normalizeFleetId(initialFleetId ?? "")
  )
  const [fleetInput, setFleetInput] = useState(fleetId)
  const [generation, setGeneration] = useState<PttTruckGeneration>("UNKNOWN")
  const [odometer, setOdometer] = useState("")
  const [batchLabel, setBatchLabel] = useState(defaultBatchLabel)
  const [workshopContext, setWorkshopContext] = useState("")
  const [items, setItems] = useState<PhotoItem[]>([])
  const [processing, setProcessing] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [error, setError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Source of truth for the selected photos (state mirrors it for rendering)
  // so concurrent / async additions never read a stale list.
  const itemsRef = useRef<PhotoItem[]>([])
  const addQueueRef = useRef<Promise<void>>(Promise.resolve())
  // Photos already stored in Blob, so a retry after a mid-upload failure
  // doesn't upload them twice. Cleared when analysis fails, because the
  // analyze route deletes its temporary blobs on failure.
  const uploadedRef = useRef(
    new Map<string, { fleetId: string; attachment: UploadedAttachment }>()
  )

  // Follow the parent's truck selection (e.g. "Scan Truck" in Fleet
  // Coverage) without remounting, so selected photos survive.
  const [syncedKey, setSyncedKey] = useState(`${initialFleetId}|${syncToken}`)
  const syncKey = `${initialFleetId}|${syncToken}`
  if (syncKey !== syncedKey) {
    setSyncedKey(syncKey)
    if (initialFleetId) {
      const next = normalizeFleetId(initialFleetId)
      setFleetId(next)
      setFleetInput(next)
    }
  }

  const busy = phase.kind !== "idle"

  useEffect(
    () => () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl)
    },
    []
  )

  const fleetItems = useMemo(() => {
    const typed = normalizeFleetId(fleetInput)
    return typed && !rosterFleetIds.includes(typed)
      ? [typed, ...rosterFleetIds]
      : rosterFleetIds
  }, [fleetInput, rosterFleetIds])

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

  async function uploadPhoto(
    item: PhotoItem,
    normalizedFleetId: string
  ): Promise<UploadedAttachment> {
    const cached = uploadedRef.current.get(item.id)
    if (cached && cached.fleetId === normalizedFleetId) return cached.attachment

    const formData = new FormData()
    formData.append("file", item.file)
    formData.append("fleetId", normalizedFleetId)
    const response = await fetch("/api/diagnostics/upload", {
      method: "POST",
      body: formData,
    })
    const attachment = await readApiResponse<UploadedAttachment>(
      response,
      `Could not upload "${item.file.name}"`
    )
    uploadedRef.current.set(item.id, { fleetId: normalizedFleetId, attachment })
    return attachment
  }

  async function runAnalysis() {
    if (busy) return

    const normalizedFleetId = normalizeFleetId(fleetId || fleetInput)
    if (!normalizedFleetId) {
      setError("Enter the truck Fleet ID (e.g. MTL61).")
      return
    }
    const odometerText = odometer.trim()
    let odometerKm: number | undefined
    if (odometerText) {
      if (!/^\d+$/.test(odometerText)) {
        setError("Odometer must be a whole number of kilometres.")
        return
      }
      odometerKm = Number(odometerText)
    }
    const photos = itemsRef.current
    if (photos.length === 0) {
      setError("Add at least one PTT photo.")
      return
    }

    setError(null)
    try {
      const attachments: UploadedAttachment[] = []
      for (const [index, item] of photos.entries()) {
        setPhase({ kind: "uploading", current: index + 1, total: photos.length })
        attachments.push(await uploadPhoto(item, normalizedFleetId))
      }

      setPhase({ kind: "analyzing" })
      let session: PttSessionWithRelations
      try {
        const response = await fetch("/api/diagnostics/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fleetId: normalizedFleetId,
            truckGeneration: generation,
            odometerKm,
            scanBatchLabel: batchLabel.trim() || undefined,
            workshopContext: workshopContext.trim() || undefined,
            attachments,
          }),
        })
        session = revivePttSession(
          await readApiResponse<unknown>(response, "Analysis failed")
        )
      } catch (analysisError) {
        // The analyze route removes its temporary blobs on failure, so these
        // uploads can't be reused. The local files stay selected for a retry.
        uploadedRef.current.clear()
        throw analysisError
      }

      // Success: clear the form (the batch label is kept for the sweep).
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl)
      uploadedRef.current.clear()
      commitItems([])
      setFleetId("")
      setFleetInput("")
      setGeneration("UNKNOWN")
      setOdometer("")
      setWorkshopContext("")
      toast.add({
        title: `${normalizedFleetId} scan analysed`,
        description: "The Executive Directive is ready.",
        type: "success",
      })
      onScanComplete(session)
    } catch (scanError) {
      const message =
        scanError instanceof Error
          ? scanError.message
          : "Something went wrong. Please try again."
      setError(message)
      toast.add({
        title: "Scan failed",
        description: `${message} Your photos are still selected — click Run Analysis to retry.`,
        type: "error",
      })
    } finally {
      setPhase({ kind: "idle" })
    }
  }

  const progressLabel =
    phase.kind === "uploading"
      ? `Uploading photo ${phase.current} of ${phase.total}...`
      : phase.kind === "analyzing"
        ? "Cross-checking 90-day Spares History & running Volvo Master AI analysis..."
        : null

  const totalBytes = items.reduce((sum, item) => sum + item.file.size, 0)

  return (
    <Card onPaste={handlePaste}>
      <CardHeader>
        <ScanLine className="mb-2 size-6 text-foreground" strokeWidth={1.75} />
        <CardTitle className="text-lg">New PTT Scan</CardTitle>
        <CardDescription>
          Upload the Volvo PTT DTC List photos for one truck. The AI reads every
          fault, cross-checks the last 90 days of spares and issues the
          Executive Directive.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            void runAnalysis()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ptt-fleet-id">Truck Fleet ID</Label>
              <Combobox
                items={fleetItems}
                value={fleetId || null}
                onValueChange={(value) => {
                  const next = value ? normalizeFleetId(value) : ""
                  setFleetId(next)
                  setFleetInput(next)
                }}
                inputValue={fleetInput}
                onInputValueChange={(value) => {
                  setFleetInput(value)
                  setFleetId(normalizeFleetId(value))
                }}
                disabled={busy}
              >
                <ComboboxInput
                  id="ptt-fleet-id"
                  placeholder="Search or type an MTL ID (e.g. MTL61)"
                  showClear
                  className="w-full"
                  autoComplete="off"
                />
                <ComboboxContent>
                  <ComboboxEmpty>Type an MTL ID to use it.</ComboboxEmpty>
                  <ComboboxList>
                    {(item: string) => (
                      <ComboboxItem key={item} value={item}>
                        <span className="font-mono">{item}</span>
                        {!rosterFleetIds.includes(item) && (
                          <span className="text-xs text-muted-foreground">
                            new truck
                          </span>
                        )}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>

            <div className="grid gap-1.5">
              <Label id="ptt-generation-label">Truck Generation</Label>
              <ToggleGroup
                variant="outline"
                spacing={0}
                aria-labelledby="ptt-generation-label"
                value={[generation]}
                onValueChange={(value) => {
                  const next = value[0] as PttTruckGeneration | undefined
                  if (next) setGeneration(next)
                }}
                disabled={busy}
              >
                {GENERATION_OPTIONS.map((option) => (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    className="px-3"
                  >
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ptt-odometer">Odometer (km) — optional</Label>
              <Input
                id="ptt-odometer"
                inputMode="numeric"
                placeholder="e.g. 412350"
                value={odometer}
                onChange={(event) => setOdometer(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ptt-batch">Scan Batch Label — optional</Label>
              <Input
                id="ptt-batch"
                maxLength={200}
                value={batchLabel}
                onChange={(event) => setBatchLabel(event.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ptt-context">
              Workshop Context / Mechanic Claim — optional
            </Label>
            <Textarea
              id="ptt-context"
              rows={3}
              maxLength={4000}
              placeholder="Optional: e.g., Driver reports erratic shifting; mechanics want to replace the clutch actuator or harness..."
              value={workshopContext}
              onChange={(event) => setWorkshopContext(event.target.value)}
              disabled={busy}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label>PTT Photos</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {items.length} / {MAX_PHOTOS} photos
                {items.length > 0 && ` · ${formatBytes(totalBytes)}`}
              </span>
            </div>

            <div
              role="button"
              tabIndex={0}
              aria-label="Add PTT photos: drop files, click to browse, or paste a screenshot"
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
                "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-8 text-center transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/50",
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
                  : "Drop PTT photos here, click to browse, or press Ctrl+V to paste"}
              </p>
              <p className="text-xs text-muted-foreground">
                JPG, PNG or WEBP · up to {MAX_PHOTOS} photos · overlapping
                scrolled screens of the same DTC List are fine
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
          </div>

          {error && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Scan could not be completed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={busy || processing > 0 || items.length === 0}
            >
              {busy ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : (
                <ScanLine data-icon="inline-start" />
              )}
              {busy ? "Working..." : "Run Analysis"}
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
        </form>
      </CardContent>
    </Card>
  )
}
