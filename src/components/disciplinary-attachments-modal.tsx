"use client"

import { useRef, useState } from "react"
import {
  ExternalLinkIcon,
  FileTextIcon,
  ImageIcon,
  Loader2Icon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import {
  formatCaseDateTime,
  type DisciplinaryCase,
} from "@/lib/disciplinary-cases"
import {
  HR_ATTACHMENT_DOC_LABELS,
  HR_ATTACHMENT_EXTENSIONS,
  HR_ATTACHMENT_MAX_BYTES,
  type HrAttachmentDocLabel,
} from "@/lib/hr-disciplinary"
import { cn } from "@/lib/utils"

type Attachment = DisciplinaryCase["attachments"][number]

// Images above this size are downscaled/re-encoded in the browser so phone
// photos stay under Vercel's 4.5 MB request-body limit.
const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 2000
const JPEG_QUALITY = 0.82

const DOC_LABEL_ITEMS = Object.fromEntries(
  HR_ATTACHMENT_DOC_LABELS.map((label) => [label, label])
)

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(dot).toLowerCase()
}

function isImageName(name: string) {
  const ext = extensionOf(name)
  return ext === ".jpg" || ext === ".jpeg" || ext === ".png"
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Resizes (longest side <= 2000 px) and re-encodes a large image as JPEG on a
// canvas. Falls back to the original file if anything goes wrong or the
// result isn't actually smaller. PDFs and small images are never touched.
async function prepareFile(file: File): Promise<File> {
  if (!isImageName(file.name) || file.size <= COMPRESS_THRESHOLD_BYTES) {
    return file
  }

  try {
    // `from-image` applies the EXIF rotation phones record.
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    })
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height)
    )
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) {
      bitmap.close()
      return file
    }
    // JPEG has no alpha channel: paint white so transparent PNGs don't go black.
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    )
    if (!blob || blob.size >= file.size) return file

    const ext = extensionOf(file.name)
    const stem = file.name.slice(0, file.name.length - ext.length)
    return new File([blob], `${stem}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    })
  } catch {
    return file
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong."
}

async function readError(response: Response, fallback: string) {
  try {
    const body: unknown = await response.json()
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error
    }
  } catch {
    // Non-JSON error body — use the fallback.
  }
  return fallback
}

// Mount this only while a case's documents are open; `onClose` unmounts it.
// `caseItem` should come from the workspace's live `cases` state so the list
// updates as soon as `onChanged` has refreshed it.
export function DisciplinaryAttachmentsModal({
  caseItem,
  onClose,
  onChanged,
}: {
  caseItem: DisciplinaryCase
  onClose: () => void
  // Called after files are uploaded or deleted; refreshes the cases list.
  onChanged: () => Promise<void> | void
}) {
  const [docLabel, setDocLabel] = useState<HrAttachmentDocLabel>(
    HR_ATTACHMENT_DOC_LABELS[0]
  )
  const [selected, setSelected] = useState<File[]>([])
  const [inputKey, setInputKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Attachment | null>(null)
  const [deleting, setDeleting] = useState(false)
  const busyRef = useRef(false)

  const attachments = [...caseItem.attachments].sort(
    (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()
  )

  function handleFilesChosen(files: FileList | null) {
    setSelected(files ? Array.from(files) : [])
  }

  async function handleUpload() {
    if (busyRef.current || selected.length === 0) return
    busyRef.current = true
    setUploading(true)

    let uploaded = 0
    const failures: string[] = []

    // One request per file: Vercel's 4.5 MB limit applies to the whole
    // request body, so batching several files could exceed it.
    for (const original of selected) {
      try {
        const ext = extensionOf(original.name)
        if (
          !(HR_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)
        ) {
          throw new Error("Only PDF, JPG and PNG files are allowed.")
        }

        const file = await prepareFile(original)
        if (file.size > HR_ATTACHMENT_MAX_BYTES) {
          throw new Error(
            `Larger than 4.5 MB (${formatFileSize(file.size)}).`
          )
        }

        const body = new FormData()
        body.append("docLabel", docLabel)
        body.append("files", file)
        const response = await fetch(
          `/api/hr/cases/${caseItem.id}/attachments`,
          { method: "POST", body }
        )
        if (!response.ok) {
          throw new Error(await readError(response, "Upload failed."))
        }
        uploaded += 1
      } catch (error) {
        failures.push(`${original.name}: ${errorMessage(error)}`)
      }
    }

    if (uploaded > 0) {
      toast.add({
        title:
          uploaded === 1 ? "Document uploaded" : `${uploaded} documents uploaded`,
        description: `Filed as "${docLabel}".`,
        type: "success",
      })
      await onChanged()
    }
    if (failures.length > 0) {
      toast.add({
        title:
          failures.length === 1
            ? "Upload failed"
            : `${failures.length} uploads failed`,
        description: failures.join("\n"),
        type: "error",
      })
    }

    // Reset the picker (a file input can't be re-filled programmatically);
    // failed files are named in the error toast so they can be re-picked.
    setSelected([])
    setInputKey((key) => key + 1)
    setUploading(false)
    busyRef.current = false
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const response = await fetch(`/api/hr/attachments/${deleteTarget.id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        throw new Error(await readError(response, "Delete failed."))
      }
      toast.add({
        title: "Document deleted",
        description: deleteTarget.fileName,
        type: "success",
      })
      setDeleteTarget(null)
      await onChanged()
    } catch (error) {
      toast.add({
        title: "Could not delete document",
        description: errorMessage(error),
        type: "error",
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !uploading) onClose()
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Signed Documents</DialogTitle>
            <DialogDescription>
              Upload signed paperwork or dispute statements (PDF, JPG or PNG,
              up to 4.5 MB each).
            </DialogDescription>
            <dl className="mt-1 grid grid-cols-3 gap-3 rounded-lg border bg-muted/40 p-3 text-xs">
              <div className="min-w-0">
                <dt className="text-muted-foreground">Case Ref</dt>
                <dd className="truncate font-medium" title={caseItem.caseRef}>
                  {caseItem.caseRef}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">Offender</dt>
                <dd
                  className="truncate font-medium"
                  title={caseItem.driverName}
                >
                  {caseItem.driverName || "—"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">Fleet ID</dt>
                <dd className="truncate font-medium" title={caseItem.fleetId}>
                  {caseItem.fleetId}
                </dd>
              </div>
            </dl>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="attachment-doc-label">Document label</Label>
                <Select
                  items={DOC_LABEL_ITEMS}
                  value={docLabel}
                  disabled={uploading}
                  onValueChange={(value) => {
                    if (
                      value &&
                      (HR_ATTACHMENT_DOC_LABELS as readonly string[]).includes(
                        value
                      )
                    ) {
                      setDocLabel(value as HrAttachmentDocLabel)
                    }
                  }}
                >
                  <SelectTrigger id="attachment-doc-label" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HR_ATTACHMENT_DOC_LABELS.map((label) => (
                      <SelectItem key={label} value={label}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="attachment-files">Files</Label>
                <Input
                  key={inputKey}
                  id="attachment-files"
                  type="file"
                  multiple
                  accept="application/pdf,image/jpeg,image/png"
                  disabled={uploading}
                  onChange={(event) => handleFilesChosen(event.target.files)}
                />
              </div>
            </div>

            {selected.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {selected.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-1.5"
                  >
                    {isImageName(file.name) ? (
                      <ImageIcon className="size-3 shrink-0" />
                    ) : (
                      <FileTextIcon className="size-3 shrink-0" />
                    )}
                    <span className="min-w-0 truncate">{file.name}</span>
                    <span className="shrink-0">
                      ({formatFileSize(file.size)})
                    </span>
                    {!uploading && (
                      <button
                        type="button"
                        className="ml-auto shrink-0 rounded p-0.5 hover:bg-muted"
                        aria-label={`Remove ${file.name}`}
                        onClick={() =>
                          setSelected((current) =>
                            current.filter((_, i) => i !== index)
                          )
                        }
                      >
                        <XIcon className="size-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex justify-end">
              <Button
                disabled={uploading || selected.length === 0}
                onClick={() => void handleUpload()}
              >
                {uploading ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <UploadIcon />
                )}
                {uploading
                  ? "Uploading…"
                  : `Upload${selected.length > 1 ? ` ${selected.length} files` : ""}`}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t pt-3">
            <h3 className="text-xs font-medium text-muted-foreground">
              Uploaded documents ({attachments.length})
            </h3>
            {attachments.length === 0 ? (
              <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                No signed documents uploaded yet.
              </p>
            ) : (
              <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
                {attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="flex items-center gap-3 rounded-lg border p-2.5"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge variant="secondary" className="shrink-0">
                          {attachment.docLabel}
                        </Badge>
                        <span
                          className="min-w-0 truncate text-sm font-medium"
                          title={attachment.fileName}
                        >
                          {attachment.fileName}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(attachment.fileSize)} · Uploaded{" "}
                        {formatCaseDateTime(attachment.uploadedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <a
                        href={`/api/hr/attachments/${attachment.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          buttonVariants({ variant: "outline", size: "xs" })
                        )}
                      >
                        <ExternalLinkIcon />
                        View / Download
                      </a>
                      <Button
                        variant="destructive"
                        size="xs"
                        disabled={uploading}
                        onClick={() => setDeleteTarget(attachment)}
                      >
                        <Trash2Icon />
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.fileName} will be permanently removed from{" "}
              {caseItem.caseRef}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleConfirmDelete()}
            >
              {deleting && <Loader2Icon className="animate-spin" />}
              Delete document
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
