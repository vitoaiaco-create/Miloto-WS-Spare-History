import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ComplianceStatus } from "@/lib/workshop-events"

const STATUS_STYLES: Record<ComplianceStatus, string> = {
  PENDING:
    "bg-orange-500/15 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  FAILED: "bg-red-500/15 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  OK: "bg-green-500/15 text-green-700 dark:bg-green-500/20 dark:text-green-300",
}

// PENDING = orange, FAILED = red, OK = green.
export function ComplianceStatusBadge({
  status,
  className,
}: {
  status: ComplianceStatus
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn(STATUS_STYLES[status], "border-transparent", className)}>
      {status}
    </Badge>
  )
}
