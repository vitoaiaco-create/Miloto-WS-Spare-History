"use client"

import { CheckCircle2, Crosshair, Printer, Wrench } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import type { ComponentType } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
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
import {
  analyticsPeriodLabel,
  analyticsPeriodOptions,
  formatAnalyticsPeriod,
  type AnalyticsPeriod,
} from "@/lib/analytics-period"
import {
  DIRECTOR_SUMMARY_EVENT_TYPES,
  DIRECTOR_SUMMARY_SYSTEMS,
  DIRECTOR_SUMMARY_TRAILER_SYSTEMS,
  isDirectorSummaryPrimeMover,
  isDirectorSummaryTrailer,
  type DirectorSummaryCellEvent,
  type DirectorSummaryEventType,
  type DirectorSummaryMatrixPayload,
  type DirectorSummaryRow,
  type DirectorSummarySystem,
} from "@/lib/director-summary-matrix"
import { cn } from "@/lib/utils"

const EVENT_ICON: Record<
  DirectorSummaryEventType,
  {
    Icon: ComponentType<{ className?: string }>
    className: string
    label: string
  }
> = {
  Intervention: {
    Icon: Wrench,
    className: "text-blue-600 print:text-blue-600",
    label: "Intervention",
  },
  Alignment: {
    Icon: Crosshair,
    className: "text-orange-500 print:text-orange-500",
    label: "Alignment",
  },
  Check: {
    Icon: CheckCircle2,
    className: "text-green-600 print:text-green-600",
    label: "Check OK",
  },
}

const TABLE_CONTAINER_CLASS =
  "relative w-full max-h-[calc(100vh-250px)] overflow-auto print:max-h-none print:overflow-visible [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"

function MatrixEventLine({ event }: { event: DirectorSummaryCellEvent }) {
  const { Icon, className, label } = EVENT_ICON[event.eventType]

  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] leading-tight print:text-[9px]"
      title={`${label} ${event.formattedDate}`}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3 shrink-0 print:size-2.5 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
          className
        )}
      />
      <span className="tabular-nums">{event.formattedDate}</span>
    </span>
  )
}

function PeriodSelect({ period }: { period: AnalyticsPeriod }) {
  const router = useRouter()
  const pathname = usePathname()
  const value = formatAnalyticsPeriod(period)

  const options = analyticsPeriodOptions()
  const hasCurrentValue = options.some((option) => option.value === value)
  const selectableOptions = hasCurrentValue
    ? options
    : [{ value, label: analyticsPeriodLabel(period) }, ...options]

  function onValueChange(next: string | null) {
    if (!next || next === value) return
    router.replace(`${pathname}?period=${next}`, { scroll: false })
  }

  return (
    <div className="flex min-w-[180px] flex-col gap-1.5 print:hidden">
      <Label htmlFor="director-summary-period">Month</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id="director-summary-period" className="w-[180px]">
          <SelectValue placeholder="Select month" />
        </SelectTrigger>
        <SelectContent>
          {selectableOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function DirectorSummaryAssetTable({
  title,
  rows,
  systems,
  periodLabel,
}: {
  title: string
  rows: DirectorSummaryRow[]
  systems: readonly DirectorSummarySystem[]
  periodLabel: string
}) {
  const columnCount = systems.length + 1

  return (
    <div className="flex flex-col gap-2 print:gap-1">
      <h2 className="text-lg font-semibold tracking-tight print:block print:pt-2 print:text-sm print:text-black">
        {title}
      </h2>
      <Table className="print:text-xs" containerClassName={TABLE_CONTAINER_CLASS}>
        <TableHeader className="sticky top-0 z-20 bg-background shadow-sm print:static print:shadow-none [&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-background print:[&_th]:static">
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-30 min-w-[7rem] bg-background print:static">
              Asset
            </TableHead>
            {systems.map((system) => (
              <TableHead
                key={system}
                className="min-w-[6.5rem] whitespace-normal text-center leading-tight print:min-w-0 print:px-1 print:text-[9px]"
              >
                {system}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columnCount}
                className="py-10 text-center text-muted-foreground"
              >
                No interventions, alignments, or checks for {periodLabel}.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.assetName} className="print:h-auto">
                <TableCell className="sticky left-0 z-10 bg-background font-medium print:static print:bg-transparent print:px-1 print:text-[9px]">
                  {row.assetName}
                </TableCell>
                {systems.map((system) => {
                  const events = row.cells[system]
                  return (
                    <TableCell
                      key={system}
                      className="align-top whitespace-normal px-1.5 py-1 print:px-1 print:py-0.5"
                    >
                      {events.length > 0 ? (
                        <div className="flex flex-col gap-1 print:gap-0.5">
                          {events.map((event) => (
                            <MatrixEventLine
                              key={`${row.assetName}-${system}-${event.eventType}`}
                              event={event}
                            />
                          ))}
                        </div>
                      ) : null}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export function DirectorSummaryMatrix({
  data,
}: {
  data: DirectorSummaryMatrixPayload
}) {
  const period = { year: data.year, month: data.month }
  const truckRows = data.rows.filter((row) =>
    isDirectorSummaryPrimeMover(row.assetName)
  )
  const trailerRows = data.rows.filter((row) =>
    isDirectorSummaryTrailer(row.assetName)
  )

  return (
    <Card
      id="director-summary-matrix"
      className="overflow-visible print:overflow-visible print:ring-0"
    >
      <style>{`
        @media print {
          @page {
            size: A1 landscape;
            margin: 8mm;
          }
          body * { visibility: hidden; }
          #director-summary-matrix,
          #director-summary-matrix * { visibility: visible; }
          #director-summary-matrix {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            overflow: visible;
            box-shadow: none;
            background: white;
          }
        }
      `}</style>
      <CardHeader>
        <CardTitle>Director&apos;s Summary Matrix</CardTitle>
        <CardDescription>
          Recency map of mechanical interventions, wheel alignments, and
          routine checks for {data.periodLabel}. Print on A1 or A0 landscape.
        </CardDescription>
        <CardAction className="flex items-center gap-2 print:hidden">
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
          >
            <Printer data-icon="inline-start" />
            Print
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 print:gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <PeriodSelect period={period} />
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs print:text-[9px]">
            {DIRECTOR_SUMMARY_EVENT_TYPES.map((eventType) => {
              const { Icon, className, label } = EVENT_ICON[eventType]
              return (
                <li key={eventType} className="inline-flex items-center gap-1.5">
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "size-3.5 print:size-2.5 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
                      className
                    )}
                  />
                  {label}
                </li>
              )
            })}
          </ul>
        </div>

        <DirectorSummaryAssetTable
          title="Prime Movers (MTL)"
          rows={truckRows}
          systems={DIRECTOR_SUMMARY_SYSTEMS}
          periodLabel={data.periodLabel}
        />
        <DirectorSummaryAssetTable
          title="Trailers (MT)"
          rows={trailerRows}
          systems={DIRECTOR_SUMMARY_TRAILER_SYSTEMS}
          periodLabel={data.periodLabel}
        />
      </CardContent>
    </Card>
  )
}
