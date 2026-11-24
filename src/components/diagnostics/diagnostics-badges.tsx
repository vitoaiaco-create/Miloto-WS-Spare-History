import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// Shared severity / status / generation visuals for the Fleet Diagnostics
// (PTT Intel) dashboard.

export const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "Critical",
  CALIBRATION_ONLY: "Calibration Only",
  MONITOR: "Monitor",
  NEGLIGIBLE: "Negligible",
  CLEAR: "Clear",
}

const SEVERITY_CLASSES: Record<string, string> = {
  CRITICAL:
    "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  CALIBRATION_ONLY:
    "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300",
  MONITOR:
    "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  NEGLIGIBLE:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  CLEAR:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
}

export function SeverityBadge({
  severity,
  className,
}: {
  severity: string
  className?: string
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(SEVERITY_CLASSES[severity], className)}
    >
      {SEVERITY_LABELS[severity] ?? severity}
    </Badge>
  )
}

export const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  SCANNED: "Scanned",
  DIRECTIVE_ISSUED: "Directive Issued",
  IN_PROGRESS: "In Progress",
  VERIFIED_CLOSED: "Verified Closed",
}

const WORKFLOW_STATUS_CLASSES: Record<string, string> = {
  SCANNED: "",
  DIRECTIVE_ISSUED:
    "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300",
  IN_PROGRESS:
    "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300",
  VERIFIED_CLOSED:
    "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300",
}

export function WorkflowStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={WORKFLOW_STATUS_CLASSES[status]}>
      {WORKFLOW_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

const GENERATION_LABELS: Record<string, string> = {
  FH_V3: "FH V3",
  FH_V4: "FH V4",
  UNKNOWN: "Gen Unknown",
}

export function GenerationBadge({ generation }: { generation: string }) {
  return (
    <Badge variant="outline" className="font-mono">
      {GENERATION_LABELS[generation] ?? generation}
    </Badge>
  )
}

// Compact per-tier fault counts: C(ritical), Cal(ibration), M(onitor),
// N(egligible). Zero counts are dimmed so non-zero tiers stand out.
export function FaultCountPills({
  criticalCount,
  calibrationCount,
  monitorCount,
  negligibleCount,
}: {
  criticalCount: number
  calibrationCount: number
  monitorCount: number
  negligibleCount: number
}) {
  const pills = [
    { label: "C", title: "Critical", count: criticalCount, tier: "CRITICAL" },
    {
      label: "Cal",
      title: "Calibration Only",
      count: calibrationCount,
      tier: "CALIBRATION_ONLY",
    },
    { label: "M", title: "Monitor", count: monitorCount, tier: "MONITOR" },
    {
      label: "N",
      title: "Negligible",
      count: negligibleCount,
      tier: "NEGLIGIBLE",
    },
  ]

  return (
    <div className="flex items-center gap-1" aria-label="Fault counts">
      {pills.map((pill) => (
        <Badge
          key={pill.tier}
          variant="secondary"
          title={`${pill.title}: ${pill.count}`}
          className={cn(
            "font-mono tabular-nums",
            pill.count > 0
              ? SEVERITY_CLASSES[pill.tier]
              : "bg-transparent text-muted-foreground/60"
          )}
        >
          {pill.label} {pill.count}
        </Badge>
      ))}
    </div>
  )
}
