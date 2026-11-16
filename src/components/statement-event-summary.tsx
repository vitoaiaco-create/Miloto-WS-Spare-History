import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  type StatementEventCategory,
  type StatementEventCategorySummary,
} from "@/lib/spares-statement"

const CATEGORY_DESCRIPTION: Record<StatementEventCategory, string> = {
  "Wheel Alignment": "Out-of-square alignment checks",
  "Air System Check": "Preventative air system tests",
  "Injector Trim Codes": "Prime mover injector trim entries",
}

// One card per reporting category (Wheel Alignment, Air System Check,
// Injector Trim Codes) for the lines currently shown on the statement.
export function StatementEventSummary({
  summary,
}: {
  summary: StatementEventCategorySummary[]
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3 print:hidden">
      {summary.map((item) => (
        <Card key={item.category} size="sm">
          <CardHeader>
            <CardDescription>{item.category}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {item.events}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            <span>{CATEGORY_DESCRIPTION[item.category]}</span>
            <span>
              {item.assets} {item.assets === 1 ? "asset" : "assets"}
              {item.failed > 0 ? (
                <span className="font-medium text-destructive">
                  {" "}
                  · {item.failed} failed
                </span>
              ) : null}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
