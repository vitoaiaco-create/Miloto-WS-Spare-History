"use client"

import { format } from "date-fns"
import { useRouter } from "next/navigation"
import {
  useMemo,
  useOptimistic,
  useState,
  useTransition,
  type ReactNode,
} from "react"
import {
  ChevronDownIcon,
  ClipboardListIcon,
  CopyIcon,
  ImageIcon,
  Loader2Icon,
  MessageCircleIcon,
  MicroscopeIcon,
  ShieldAlertIcon,
  SearchCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react"

import {
  GenerationBadge,
  SEVERITY_LABELS,
  SeverityBadge,
} from "@/components/diagnostics/diagnostics-badges"
import { CloseJobButton } from "@/components/diagnostics/case-closure-controls"
import { DeleteScanDialog } from "@/components/diagnostics/delete-scan-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { updatePttSessionStatus } from "@/actions/ptt-diagnostics"
import {
  PTT_SESSION_STATUSES,
  PTT_SEVERITY_RANK,
  formatPttDirectiveForWhatsApp,
  normalizeFleetId,
  type PttFaultSeverity,
  type PttSessionStatus,
} from "@/lib/ptt-diagnostics"
import type {
  PttApprovedExceptionRow,
  PttSessionWithRelations,
} from "@/lib/ptt-diagnostics-queries"
import {
  MANUAL_CLOSE_HINT,
  canSetWorkflowVerifiedClosed,
} from "@/lib/ptt/closure-guard"
import { cn } from "@/lib/utils"

const STATUS_ITEMS: { value: PttSessionStatus; label: string }[] = [
  { value: "SCANNED", label: "Scanned" },
  { value: "DIRECTIVE_ISSUED", label: "Directive Issued" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "VERIFIED_CLOSED", label: "Verified Closed" },
]

type FaultFilter = "ALL" | PttFaultSeverity

const FAULT_FILTERS: { value: FaultFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "CRITICAL", label: "Critical" },
  { value: "CALIBRATION_ONLY", label: "Calibration Only" },
  { value: "MONITOR", label: "Monitor" },
  { value: "NEGLIGIBLE", label: "Negligible" },
]

const FAULT_STATE_CLASSES: Record<string, string> = {
  ACTIVE:
    "border-red-300 text-red-700 dark:border-red-900 dark:text-red-300",
  INACTIVE: "text-muted-foreground",
  UNKNOWN: "border-dashed text-muted-foreground",
}

function formatScanDate(date: Date) {
  return format(date, "dd MMM yyyy, HH:mm")
}

function formatSessionOption(session: PttSessionWithRelations) {
  return `${formatScanDate(session.scannedAt)} · ${SEVERITY_LABELS[session.overallSeverity] ?? session.overallSeverity}`
}

function SectionCard({
  title,
  icon,
  className,
  titleClassName,
  children,
}: {
  title: string
  icon: ReactNode
  className?: string
  titleClassName?: string
  children: ReactNode
}) {
  return (
    <section className={cn("flex flex-col gap-2 rounded-xl border p-4", className)}>
      <h3
        className={cn(
          "flex items-center gap-2 text-sm font-semibold [&_svg]:size-4",
          titleClassName
        )}
      >
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function DirectiveText({ text, empty }: { text: string; empty: string }) {
  const trimmed = text.trim()
  return trimmed ? (
    <p className="text-sm leading-relaxed whitespace-pre-line">{trimmed}</p>
  ) : (
    <p className="text-sm text-muted-foreground">{empty}</p>
  )
}

function BulletList({
  title,
  items,
  empty,
}: {
  title: string
  items: string[]
  empty: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm leading-relaxed marker:text-muted-foreground">
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function PttDirectiveModal({
  session,
  fleetSessions,
  onSelectSession,
  onClose,
  onSessionDeleted,
  onSessionUpdate,
  exceptions,
  verificationSlot,
}: {
  /** The scan to show. `null` keeps the modal closed. */
  session: PttSessionWithRelations | null
  /** Every scan of the same truck, newest first (includes `session`). */
  fleetSessions: PttSessionWithRelations[]
  onSelectSession: (sessionId: number) => void
  onClose: () => void
  /** Called after a scan (the one shown) was deleted; the parent syncs state. */
  onSessionDeleted: (sessionId: number) => void
  /** Called with the refreshed session after a case closure / reopen. */
  onSessionUpdate: (session: PttSessionWithRelations) => void
  /** Active approved exceptions (drive the Close Job eligibility). */
  exceptions: readonly PttApprovedExceptionRow[]
  /** Slot for the Before/After Re-Scan Verification uploader and audit card. */
  verificationSlot?: ReactNode
}) {
  return (
    <Dialog
      open={session !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-5xl">
        {session && (
          // Remounted per scan so filters / optimistic state never leak
          // between sessions.
          <ModalBody
            key={session.id}
            session={session}
            fleetSessions={fleetSessions}
            onSelectSession={onSelectSession}
            onSessionDeleted={onSessionDeleted}
            onSessionUpdate={onSessionUpdate}
            exceptions={exceptions}
            verificationSlot={verificationSlot}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ModalBody({
  session,
  fleetSessions,
  onSelectSession,
  onSessionDeleted,
  onSessionUpdate,
  exceptions,
  verificationSlot,
}: {
  session: PttSessionWithRelations
  fleetSessions: PttSessionWithRelations[]
  onSelectSession: (sessionId: number) => void
  onSessionDeleted: (sessionId: number) => void
  onSessionUpdate: (session: PttSessionWithRelations) => void
  exceptions: readonly PttApprovedExceptionRow[]
  verificationSlot?: ReactNode
}) {
  const router = useRouter()
  const fleetId = normalizeFleetId(session.fleetId)
  const directive = session.aiDirective

  // Status: optimistic during the transition, rolled back automatically when
  // the action fails (the base value never changed).
  const [status, setOptimisticStatus] = useOptimistic<
    PttSessionStatus,
    PttSessionStatus
  >(session.status, (_current, next) => next)
  const [isStatusPending, startStatusTransition] = useTransition()

  // `Verified Closed` is only selectable once a verification scan passed.
  const canClose = canSetWorkflowVerifiedClosed({
    caseStatus: session.caseStatus,
    latestVerificationCaseStatus:
      session.verificationScans[0]?.caseStatus ?? null,
  })

  const [faultFilter, setFaultFilter] = useState<FaultFilter>("ALL")
  const [confirmDelete, setConfirmDelete] = useState(false)

  const whatsappMessage = useMemo(
    () => formatPttDirectiveForWhatsApp(session),
    [session]
  )

  const faults = useMemo(
    () =>
      [...session.faults].sort(
        (a, b) =>
          PTT_SEVERITY_RANK[b.severity] - PTT_SEVERITY_RANK[a.severity] ||
          a.faultCode.localeCompare(b.faultCode)
      ),
    [session.faults]
  )
  const filterCounts = useMemo(() => {
    const counts: Record<FaultFilter, number> = {
      ALL: faults.length,
      CRITICAL: 0,
      CALIBRATION_ONLY: 0,
      MONITOR: 0,
      NEGLIGIBLE: 0,
    }
    for (const fault of faults) counts[fault.severity] += 1
    return counts
  }, [faults])
  const visibleFaults =
    faultFilter === "ALL"
      ? faults
      : faults.filter((fault) => fault.severity === faultFilter)

  const screenshots = session.attachments.filter(
    (attachment) => attachment.role === "INITIAL_SCAN"
  )
  const spares = session.sparesContextSnapshot

  function changeStatus(next: PttSessionStatus) {
    if (next === status) return
    startStatusTransition(async () => {
      setOptimisticStatus(next)
      const result = await updatePttSessionStatus(session.id, next)
      if (result.success) {
        router.refresh()
      } else {
        toast.add({
          title: "Could not update status",
          description: result.error,
          type: "error",
        })
      }
    })
  }

  function shareOnWhatsApp() {
    window.open(
      `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`,
      "_blank",
      "noopener,noreferrer"
    )
  }

  async function copyForWhatsApp() {
    try {
      await navigator.clipboard.writeText(whatsappMessage)
      toast.add({
        title: "Copied for WhatsApp",
        description: "Paste the directive into any WhatsApp chat.",
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

  return (
    <>
      <DialogHeader className="gap-3 border-b p-4 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle className="font-mono text-xl leading-none font-semibold">
            {fleetId}
          </DialogTitle>
          <GenerationBadge generation={session.truckGeneration} />
          <SeverityBadge severity={session.overallSeverity} />
          <div className="ml-auto flex items-center gap-2">
            {isStatusPending && (
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            )}
            <CloseJobButton
              session={session}
              exceptions={exceptions}
              onSessionUpdate={onSessionUpdate}
            />
            <span className="text-xs text-muted-foreground">Workflow</span>
            <Select
              items={STATUS_ITEMS}
              value={status}
              onValueChange={(value) => {
                if (value) changeStatus(value as PttSessionStatus)
              }}
            >
              <SelectTrigger size="sm" aria-label="Workflow status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="end">
                {PTT_SESSION_STATUSES.map((value) => (
                  <SelectItem
                    key={value}
                    value={value}
                    disabled={value === "VERIFIED_CLOSED" && !canClose}
                  >
                    {STATUS_ITEMS.find((item) => item.value === value)?.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {!canClose && (
          <p className="text-right text-xs text-muted-foreground">
            {MANUAL_CLOSE_HINT}
          </p>
        )}
        <DialogDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>Scanned {formatScanDate(session.scannedAt)}</span>
          {session.odometerKm != null && (
            <span className="tabular-nums">
              Odometer {session.odometerKm.toLocaleString("en-US")} km
            </span>
          )}
          {session.scanBatchLabel && <span>Batch: {session.scanBatchLabel}</span>}
        </DialogDescription>

        {fleetSessions.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Scan history ({fleetSessions.length})
            </span>
            <Select
              items={fleetSessions.map((item) => ({
                value: String(item.id),
                label: formatSessionOption(item),
              }))}
              value={String(session.id)}
              onValueChange={(value) => {
                if (value) onSelectSession(Number(value))
              }}
            >
              <SelectTrigger size="sm" aria-label="Select a previous scan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {fleetSessions.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {formatSessionOption(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </DialogHeader>

      {/* Pinned action bar: sits outside the scrolling body so WhatsApp
          dispatch and Delete Scan are always on screen. */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
        <span className="mr-auto text-sm font-medium">Actions</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copyForWhatsApp}
        >
          <CopyIcon data-icon="inline-start" />
          Copy for WhatsApp
        </Button>
        <Button type="button" size="sm" onClick={shareOnWhatsApp}>
          <MessageCircleIcon data-icon="inline-start" />
          Share on WhatsApp
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2Icon data-icon="inline-start" />
          Delete Scan
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {session.workshopContext?.trim() && (
          <div className="rounded-xl border border-dashed p-3 text-sm">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Workshop context / mechanic claim
            </span>
            <p className="mt-1 leading-relaxed whitespace-pre-line">
              {session.workshopContext.trim()}
            </p>
          </div>
        )}

        {session.scanCompletenessWarning && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
            <p className="leading-relaxed">
              {session.scanCompletenessWarning}. Capture every scroll page of
              the DTC List while the truck is still in the workshop.
            </p>
          </div>
        )}

        {directive ? (
          <div className="flex flex-col gap-4">
            <SectionCard
              title="1. Evidence Analysis"
              icon={<MicroscopeIcon />}
            >
              <DirectiveText
                text={directive.evidence_analysis}
                empty="No evidence analysis was recorded."
              />
            </SectionCard>

            <SectionCard
              title="2. Parts Warning — What NOT to Replace"
              icon={<ShieldAlertIcon />}
              titleClassName="text-red-700 dark:text-red-300"
              className="border-2 border-red-400 bg-amber-50 dark:border-red-700 dark:bg-amber-950/40"
            >
              <DirectiveText
                text={directive.parts_cannon_warning}
                empty="No parts warning was flagged for this scan."
              />
            </SectionCard>

            <SectionCard
              title="3. Root-Cause Diagnosis"
              icon={<SearchCheckIcon />}
            >
              <DirectiveText
                text={directive.true_diagnosis}
                empty="No diagnosis was recorded."
              />
            </SectionCard>

            <SectionCard
              title="4. Actionable Workshop Directive"
              icon={<WrenchIcon />}
            >
              <div className="grid gap-5 lg:grid-cols-3">
                <BulletList
                  title="Physical Inspections"
                  items={directive.physical_inspections}
                  empty="No physical inspections listed."
                />
                <BulletList
                  title="Exact Tech Tool (PTT) Navigation Paths"
                  items={directive.ptt_navigation_paths}
                  empty="No PTT navigation paths listed."
                />
                <BulletList
                  title="Verification Criteria"
                  items={directive.verification_criteria}
                  empty="No verification criteria listed."
                />
              </div>
            </SectionCard>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No directive was generated for this scan.
          </div>
        )}

        <SectionCard
          title="Extracted Fault Codes"
          icon={<ClipboardListIcon />}
        >
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Filter fault codes by tier"
          >
            {FAULT_FILTERS.map(({ value, label }) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={faultFilter === value ? "default" : "outline"}
                aria-pressed={faultFilter === value}
                onClick={() => setFaultFilter(value)}
              >
                {label}
                <span className="tabular-nums opacity-70">
                  {filterCounts[value]}
                </span>
              </Button>
            ))}
          </div>

          {visibleFaults.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {faults.length === 0
                ? "No fault codes were extracted from this scan."
                : "No fault codes in this tier."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fault Code</TableHead>
                  <TableHead>ECU</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Cal. Req.</TableHead>
                  <TableHead>Root Cause Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleFaults.map((fault) => (
                  <TableRow key={fault.id}>
                    <TableCell className="font-mono text-xs font-semibold whitespace-nowrap">
                      {fault.faultCode}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {fault.controlUnit}
                    </TableCell>
                    <TableCell className="max-w-56 whitespace-normal">
                      {fault.componentDescription}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={FAULT_STATE_CLASSES[fault.faultState]}
                      >
                        {fault.faultState === "ACTIVE"
                          ? "Active"
                          : fault.faultState === "INACTIVE"
                            ? "Inactive"
                            : "Unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fault.occurrenceCount ?? "—"}
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={fault.severity} />
                    </TableCell>
                    <TableCell>
                      {fault.calibrationRequired ? (
                        <Badge
                          variant="secondary"
                          className="bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                        >
                          Yes
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-80 text-xs leading-relaxed whitespace-normal text-muted-foreground">
                      {fault.resolvedOnRescan && (
                        <Badge
                          variant="outline"
                          className="mr-1.5 border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                        >
                          Resolved on re-scan
                        </Badge>
                      )}
                      {fault.rootCauseSummary}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <Collapsible className="rounded-xl border">
          <CollapsibleTrigger
            className="group/trigger flex w-full items-center gap-2 p-4 text-left text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            90-Day Spares Context
            <Badge variant="secondary" className="tabular-nums">
              {spares?.length ?? 0}
            </Badge>
            <span className="text-xs font-normal text-muted-foreground">
              what the AI cross-checked
            </span>
            <ChevronDownIcon className="ml-auto size-4 transition-transform group-data-panel-open/trigger:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 pb-4">
            {spares == null ? (
              <p className="text-sm text-muted-foreground">
                No spares snapshot was stored with this scan.
              </p>
            ) : spares.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No spares were issued to {fleetId} in the 90 days before this
                scan, so the AI had no recent part replacements to cross-check.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Job Card</TableHead>
                    <TableHead>Part No</TableHead>
                    <TableHead>Material Name</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">USD Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spares.map((spare, index) => (
                    <TableRow
                      key={`${spare.jobCardNo}-${spare.partNumber}-${index}`}
                    >
                      <TableCell className="whitespace-nowrap">
                        {spare.outwardDate}
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {spare.jobCardNo}
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {spare.partNumber}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {spare.materialName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {spare.quantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {spare.amountUsd ? `$${spare.amountUsd}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CollapsibleContent>
        </Collapsible>

        <SectionCard
          title={`Archived PTT Screenshots (${screenshots.length})`}
          icon={<ImageIcon />}
        >
          {screenshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No screenshots are archived for this scan.
            </p>
          ) : (
            <ul className="flex gap-3 overflow-x-auto pb-1">
              {screenshots.map((attachment) => (
                <li key={attachment.id} className="shrink-0">
                  <a
                    href={`/api/diagnostics/attachments/${attachment.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open ${attachment.fileName} in a new tab`}
                    className="group/shot flex w-40 flex-col gap-1.5 rounded-lg border bg-card p-1.5 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
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
                  </a>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {verificationSlot ?? (
          <Collapsible className="rounded-xl border border-dashed">
            <CollapsibleTrigger className="group/trigger flex w-full items-center gap-2 p-4 text-left text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Verification Re-Scan
              <Badge variant="outline">Coming soon</Badge>
              <ChevronDownIcon className="ml-auto size-4 transition-transform group-data-panel-open/trigger:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 pb-4">
              <p className="text-sm text-muted-foreground">
                After the workshop finishes the repair, the Before/After
                re-scan upload and audit result will appear here.
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Deletes the scan currently shown, whether it is the latest or an
          older one picked from the scan-history dropdown. */}
      <DeleteScanDialog
        scan={confirmDelete ? session : null}
        onOpenChange={setConfirmDelete}
        onDeleted={onSessionDeleted}
      />
    </>
  )
}