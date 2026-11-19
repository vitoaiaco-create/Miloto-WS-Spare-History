"use client"

import { useState, type DragEvent, type ReactNode } from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ClockIcon,
  DownloadIcon,
  EllipsisIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  PaperclipIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"

import { DeleteCaseDialog } from "@/components/disciplinary-delete-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { DisciplinaryCaseActions } from "@/hooks/use-disciplinary-case-actions"
import { useNow } from "@/hooks/use-now"
import {
  ELAPSED_OVERDUE_MS,
  ELAPSED_WARNING_MS,
  formatCaseDateTime,
  formatElapsed,
  HR_DISCIPLINARY_STATUSES,
  isRecentlyClosed,
  STATUS_LABELS,
  type DisciplinaryCase,
  type HrDisciplinaryStatus,
} from "@/lib/disciplinary-cases"
import { cn } from "@/lib/utils"

const COLUMN_ACCENT: Record<HrDisciplinaryStatus, string> = {
  AWAITING_SIGNATURE: "bg-amber-500",
  DISPUTED: "bg-red-500",
  CLOSED: "bg-emerald-500",
}

function ElapsedBadge({
  generatedAt,
  now,
}: {
  generatedAt: Date
  now: number
}) {
  const elapsed = Math.max(0, now - generatedAt.getTime())
  const overdue = elapsed >= ELAPSED_OVERDUE_MS
  const warning = elapsed >= ELAPSED_WARNING_MS

  return (
    <Badge
      variant="secondary"
      title={
        overdue
          ? "Overdue: more than 48h since the charge was generated"
          : warning
            ? "Approaching the 48h show-cause window"
            : "Time since the charge was generated"
      }
      className={cn(
        overdue &&
          "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
        !overdue &&
          warning &&
          "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
      )}
    >
      <ClockIcon />
      {formatElapsed(elapsed)}
    </Badge>
  )
}

function DisputeNoteDialog({
  caseItem,
  actions,
  onClose,
}: {
  caseItem: DisciplinaryCase
  actions: DisciplinaryCaseActions
  onClose: () => void
}) {
  const [draft, setDraft] = useState(caseItem.disputeNote ?? "")
  const [saving, setSaving] = useState(false)
  const inputId = `dispute-note-${caseItem.id}`

  async function handleSave() {
    setSaving(true)
    const saved = await actions.saveDisputeNote(caseItem, draft)
    setSaving(false)
    if (saved) onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {caseItem.disputeNote ? "Edit" : "Add"} dispute note
          </DialogTitle>
          <DialogDescription>
            {caseItem.caseRef}
            {caseItem.driverName ? ` · ${caseItem.driverName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={inputId}>Note</Label>
          <Textarea
            id={inputId}
            value={draft}
            rows={5}
            autoFocus
            placeholder="Why was the charge disputed?"
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void handleSave()}>
            {saving && <Loader2Icon className="animate-spin" />}
            Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function KanbanCard({
  caseItem,
  now,
  actions,
  isDragging,
  onDragStart,
  onDragEnd,
  onEditNote,
  onDelete,
  onOpenSignedDocs,
}: {
  caseItem: DisciplinaryCase
  now: number
  actions: DisciplinaryCaseActions
  isDragging: boolean
  onDragStart: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onEditNote: () => void
  onDelete: () => void
  onOpenSignedDocs?: (caseItem: DisciplinaryCase) => void
}) {
  const pending = actions.isPending(caseItem.id)
  const attachmentCount = caseItem.attachments.length
  const currentIndex = HR_DISCIPLINARY_STATUSES.indexOf(caseItem.status)

  return (
    <div
      draggable={!pending}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "flex cursor-grab flex-col gap-2.5 rounded-lg border bg-card p-3 text-card-foreground shadow-xs transition-opacity active:cursor-grabbing",
        isDragging && "opacity-40",
        pending && "cursor-progress opacity-70"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold">
          {caseItem.caseRef}
        </h3>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="-mt-0.5 -mr-1 shrink-0"
                disabled={pending}
                aria-label={`Actions for ${caseItem.caseRef}`}
              />
            }
          >
            {pending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <EllipsisIcon />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              {HR_DISCIPLINARY_STATUSES.map((status, index) =>
                status === caseItem.status ? null : (
                  <DropdownMenuItem
                    key={status}
                    onClick={() => void actions.moveCase(caseItem, status)}
                  >
                    {index > currentIndex ? (
                      <ArrowRightIcon />
                    ) : (
                      <ArrowLeftIcon />
                    )}
                    {STATUS_LABELS[status]}
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onEditNote}>
              <PencilIcon />
              {caseItem.disputeNote ? "Edit" : "Add"} dispute note
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete case
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-0.5 text-sm">
        <p className="truncate font-medium" title={caseItem.driverName}>
          {caseItem.driverName || "—"}
        </p>
        <p className="text-xs text-muted-foreground">
          ID No: {caseItem.employeeNo || "—"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">Fleet {caseItem.fleetId}</Badge>
        {caseItem.status === "AWAITING_SIGNATURE" && (
          <ElapsedBadge generatedAt={caseItem.generatedAt} now={now} />
        )}
        <Badge
          variant="outline"
          title="Signed documents"
          render={
            onOpenSignedDocs ? (
              <button
                type="button"
                className="cursor-pointer hover:bg-muted"
                onClick={() => onOpenSignedDocs(caseItem)}
              />
            ) : undefined
          }
        >
          <PaperclipIcon />
          {attachmentCount}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        Generated {formatCaseDateTime(caseItem.generatedAt)}
      </p>

      {caseItem.disputeNote && (
        <div className="flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          <MessageSquareTextIcon className="mt-0.5 size-3 shrink-0" />
          <p className="line-clamp-2" title={caseItem.disputeNote}>
            {caseItem.disputeNote}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-t pt-2.5">
        {(
          [
            ["charge", "Charge .docx"],
            ["penalty", "Penalty .docx"],
          ] as const
        ).map(([template, label]) => (
          <Button
            key={template}
            variant="outline"
            size="xs"
            disabled={actions.isDownloading(caseItem.id, template)}
            onClick={() => void actions.downloadDocument(caseItem, template)}
          >
            {actions.isDownloading(caseItem.id, template) ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <DownloadIcon />
            )}
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function DisciplinaryKanban({
  cases,
  actions,
  headerSlot,
  onOpenSignedDocs,
}: {
  cases: DisciplinaryCase[]
  actions: DisciplinaryCaseActions
  // Reserved for the "Export HR Report (PDF)" button.
  headerSlot?: ReactNode
  // Wired to the Signed Docs modal in the next step.
  onOpenSignedDocs?: (caseItem: DisciplinaryCase) => void
}) {
  const now = useNow()
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [overStatus, setOverStatus] = useState<HrDisciplinaryStatus | null>(
    null
  )
  const [noteTarget, setNoteTarget] = useState<DisciplinaryCase | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DisciplinaryCase | null>(
    null
  )

  const columns = HR_DISCIPLINARY_STATUSES.map((status) => {
    const items = cases.filter((c) => c.status === status)
    if (status !== "CLOSED") return { status, items }

    // Closed cases age out of the board after 7 days (they stay in the DB and
    // in the Historical Log).
    return {
      status,
      items: items
        .filter((c) => isRecentlyClosed(c, now))
        .sort(
          (a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0)
        ),
    }
  })

  function resetDrag() {
    setDraggingId(null)
    setOverStatus(null)
  }

  function handleDrop(
    event: DragEvent<HTMLElement>,
    status: HrDisciplinaryStatus
  ) {
    event.preventDefault()
    const id =
      draggingId ?? Number(event.dataTransfer.getData("text/plain"))
    resetDrag()

    const caseItem = cases.find((c) => c.id === id)
    if (caseItem) void actions.moveCase(caseItem, status)
  }

  // Kept mounted references stay fresh: always resolve from the latest list
  // so a dialog never shows stale data after a refresh.
  const liveNoteTarget = noteTarget
    ? (cases.find((c) => c.id === noteTarget.id) ?? null)
    : null
  const liveDeleteTarget = deleteTarget
    ? (cases.find((c) => c.id === deleteTarget.id) ?? null)
    : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Kanban Tracker</h2>
          <p className="text-sm text-muted-foreground">
            Drag cards between columns or use the card menu to move a case
            forward or back.
          </p>
        </div>
        {/* Header slot: "Export HR Report (PDF)" lands here. */}
        <div className="flex items-center gap-2">{headerSlot}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {columns.map(({ status, items }) => (
          <section
            key={status}
            aria-label={STATUS_LABELS[status]}
            onDragOver={(event) => {
              if (draggingId === null) return
              event.preventDefault()
              event.dataTransfer.dropEffect = "move"
              setOverStatus(status)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setOverStatus((current) =>
                  current === status ? null : current
                )
              }
            }}
            onDrop={(event) => handleDrop(event, status)}
            className={cn(
              "flex min-h-48 flex-col rounded-xl border bg-muted/40 transition-colors",
              overStatus === status &&
                draggingId !== null &&
                "border-primary bg-primary/5 ring-2 ring-primary/30"
            )}
          >
            <header className="flex flex-col gap-0.5 border-b px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn("size-2 rounded-full", COLUMN_ACCENT[status])}
                  />
                  <h3 className="text-sm font-semibold">
                    {STATUS_LABELS[status]}
                  </h3>
                </div>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              {status === "CLOSED" && (
                <p className="pl-4 text-xs text-muted-foreground">
                  Archived to Historical Log after 7 days
                </p>
              )}
            </header>

            <div className="flex flex-1 flex-col gap-3 p-3">
              {items.length === 0 ? (
                <p className="m-auto py-8 text-center text-xs text-muted-foreground">
                  No cases
                </p>
              ) : (
                items.map((caseItem) => (
                  <KanbanCard
                    key={caseItem.id}
                    caseItem={caseItem}
                    now={now}
                    actions={actions}
                    isDragging={draggingId === caseItem.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move"
                      event.dataTransfer.setData(
                        "text/plain",
                        String(caseItem.id)
                      )
                      setDraggingId(caseItem.id)
                    }}
                    onDragEnd={resetDrag}
                    onEditNote={() => setNoteTarget(caseItem)}
                    onDelete={() => setDeleteTarget(caseItem)}
                    onOpenSignedDocs={onOpenSignedDocs}
                  />
                ))
              )}
            </div>
          </section>
        ))}
      </div>

      {liveNoteTarget && (
        <DisputeNoteDialog
          key={liveNoteTarget.id}
          caseItem={liveNoteTarget}
          actions={actions}
          onClose={() => setNoteTarget(null)}
        />
      )}
      {liveDeleteTarget && (
        <DeleteCaseDialog
          key={liveDeleteTarget.id}
          caseItem={liveDeleteTarget}
          onConfirm={actions.deleteCase}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
