import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { PttWorkshopKpis } from "@/lib/ptt-diagnostics-queries"
import { PTT_BOUNCE_BACK_WINDOW_DAYS } from "@/lib/ptt/constants"
import { cn } from "@/lib/utils"

function formatRate(rate: number | null) {
  return rate === null ? "—" : `${rate}%`
}

function Kpi({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail: string
  tone?: "good" | "bad" | "warn"
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={cn(
            "text-3xl tabular-nums",
            tone === "good" && "text-emerald-600 dark:text-emerald-400",
            tone === "bad" && "text-red-600 dark:text-red-400",
            tone === "warn" && "text-amber-600 dark:text-amber-400"
          )}
        >
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </CardContent>
    </Card>
  )
}

/** Workshop accountability KPIs, computed from the reconciliation tables. */
export function WorkshopKpiBar({ kpis }: { kpis: PttWorkshopKpis }) {
  const noScans = kpis.verificationScanCount === 0
  return (
    <section aria-label="Workshop accountability" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        Workshop Accountability
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="First-Time Fix Rate"
          value={formatRate(kpis.firstTimeFixRate)}
          detail={
            kpis.firstTimeFixTotal === 0
              ? "No verified Critical / Calibration faults yet"
              : `${kpis.firstTimeFixCleared} of ${kpis.firstTimeFixTotal} actionable faults cleared on the first re-scan`
          }
          tone={
            kpis.firstTimeFixRate === null
              ? undefined
              : kpis.firstTimeFixRate >= 80
                ? "good"
                : "warn"
          }
        />
        <Kpi
          label="Collateral Regression Rate"
          value={formatRate(kpis.collateralRegressionRate)}
          detail={
            noScans
              ? "No verification re-scans yet"
              : `${kpis.regressionScanCount} of ${kpis.verificationScanCount} re-scans introduced a new fault`
          }
          tone={
            kpis.collateralRegressionRate !== null &&
            kpis.collateralRegressionRate > 0
              ? "bad"
              : undefined
          }
        />
        <Kpi
          label={`${PTT_BOUNCE_BACK_WINDOW_DAYS}-Day Bounce-Back Rate`}
          value={formatRate(kpis.bounceBackRate)}
          detail={`${kpis.bounceBackCount} fault${kpis.bounceBackCount === 1 ? "" : "s"} reappeared within ${PTT_BOUNCE_BACK_WINDOW_DAYS} days of being cleared`}
          tone={kpis.bounceBackCount > 0 ? "bad" : undefined}
        />
        <Kpi
          label="Open / Blocked Trucks"
          value={String(kpis.openBlockingTrucks)}
          detail="Latest case still open or blocked with a Critical / Calibration fault"
          tone={kpis.openBlockingTrucks > 0 ? "warn" : "good"}
        />
      </div>
    </section>
  )
}
