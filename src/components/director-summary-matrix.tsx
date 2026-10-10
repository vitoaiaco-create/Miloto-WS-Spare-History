"use client"

import { CheckCircle2, Crosshair, Printer, TriangleAlert, Wrench } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState, type ComponentType } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
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
  type DirectorSummaryAlignmentData,
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

const ALIGNMENT_OUT_OF_SPEC = 3.0

type AlignmentTableKind = "trucks" | "trailers"
type AlignmentAxleKey = keyof DirectorSummaryAlignmentData

const ALIGNMENT_AXLES: Record<
  AlignmentTableKind,
  { key: AlignmentAxleKey; label: string }[]
> = {
  trucks: [
    { key: "a2", label: "A2" },
    { key: "a3", label: "A3" },
  ],
  trailers: [
    { key: "a1", label: "A1" },
    { key: "a2", label: "A2" },
    { key: "a3", label: "A3" },
  ],
}

function formatSignedAlignment(value: number) {
  return `${value < 0 ? "-" : "+"}${Math.abs(value).toFixed(1)}`
}

function alignmentExceptionDisplay(
  data: DirectorSummaryAlignmentData,
  tableKind: AlignmentTableKind
): {
  Icon: ComponentType<{ className?: string }>
  className: string
  suffix: string
  label: string
} | null {
  const logged = ALIGNMENT_AXLES[tableKind]
    .map((axle) => ({ ...axle, value: data[axle.key] }))
    .filter(
      (axle): axle is typeof axle & { value: number } => axle.value != null
    )

  if (logged.length === 0) return null

  const outOfSpec = logged.filter(
    (axle) => Math.abs(axle.value) >= ALIGNMENT_OUT_OF_SPEC
  )

  if (outOfSpec.length > 0) {
    const detail = outOfSpec
      .map((axle) => `${axle.label}: ${formatSignedAlignment(axle.value)}`)
      .join(", ")
    return {
      Icon: TriangleAlert,
      className: "text-red-600 print:text-red-600",
      suffix: `(${detail})`,
      label: "Alignment out of spec",
    }
  }

  return {
    Icon: CheckCircle2,
    className: "text-green-600 print:text-green-600",
    suffix: "(OK)",
    label: "Alignment in spec",
  }
}

function MatrixEventLine({
  event,
  system,
  tableKind,
}: {
  event: DirectorSummaryCellEvent
  system: DirectorSummarySystem
  tableKind: AlignmentTableKind
}) {
  const alignment =
    system === "Alignment" && event.alignmentData
      ? alignmentExceptionDisplay(event.alignmentData, tableKind)
      : null
  const fallback = EVENT_ICON[event.eventType]
  const Icon = alignment?.Icon ?? fallback.Icon
  const className = alignment?.className ?? fallback.className
  const label = alignment?.label ?? fallback.label
  const title = alignment
    ? `${label} ${event.formattedDate} ${alignment.suffix}`
    : `${label} ${event.formattedDate}`

  return (
    <div
      className="flex items-center gap-1.5 whitespace-nowrap text-[11px] leading-tight print:text-[9px]"
      title={title}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3 shrink-0 print:size-2.5 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
          className
        )}
      />
      <span
        className={cn(
          "whitespace-nowrap tabular-nums",
          alignment?.className
        )}
      >
        {event.formattedDate}
        {alignment ? ` ${alignment.suffix}` : ""}
      </span>
    </div>
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
  printLabel,
  printSection,
  onPrint,
  hiddenOnPrint,
  rows,
  systems,
  periodLabel,
}: {
  title: string
  printLabel: string
  printSection: "trucks" | "trailers"
  onPrint: () => void
  hiddenOnPrint: boolean
  rows: DirectorSummaryRow[]
  systems: readonly DirectorSummarySystem[]
  periodLabel: string
}) {
  const columnCount = systems.length + 1

  return (
    <div
      data-print-section={printSection}
      className={cn(
        "flex flex-col gap-2 print:gap-1",
        hiddenOnPrint && "print:hidden"
      )}
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold tracking-tight print:block print:pt-2 print:text-sm print:text-black">
          {title}
        </h3>
        <Button
          type="button"
          variant="outline"
          className="print:hidden"
          onClick={onPrint}
        >
          <Printer data-icon="inline-start" />
          {printLabel}
        </Button>
      </div>
      <Table className="print:text-xs" containerClassName={TABLE_CONTAINER_CLASS}>
        <TableHeader className="sticky top-0 z-20 bg-background shadow-sm print:static print:shadow-none [&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-background print:[&_th]:static">
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-30 min-w-[7rem] border-r border-border bg-background print:static">
              Asset
            </TableHead>
            {systems.map((system) => (
              <TableHead
                key={system}
                className="min-w-[6.5rem] whitespace-normal border-r border-border text-center leading-tight print:min-w-0 print:px-1 print:text-[9px]"
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
                className="border-r border-border py-10 text-center text-muted-foreground"
              >
                No interventions, alignments, or checks for {periodLabel}.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.assetName} className="print:h-auto">
                <TableCell className="sticky left-0 z-10 border-r border-border bg-background font-medium print:static print:bg-transparent print:px-1 print:text-[9px]">
                  {row.assetName}
                </TableCell>
                {systems.map((system) => {
                  const events = row.cells[system]
                  return (
                    <TableCell
                      key={system}
                      className="align-top whitespace-normal border-r border-border px-1.5 py-1 print:px-1 print:py-0.5"
                    >
                      {events.length > 0 ? (
                        <div className="flex flex-col gap-1 print:gap-0.5">
                          {events.map((event) => (
                            <MatrixEventLine
                              key={`${row.assetName}-${system}-${event.eventType}`}
                              event={event}
                              system={system}
                              tableKind={printSection}
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
  const [printTarget, setPrintTarget] = useState<
    "both" | "trucks" | "trailers"
  >("both")

  useEffect(() => {
    const onAfterPrint = () => setPrintTarget("both")
    window.addEventListener("afterprint", onAfterPrint)
    return () => window.removeEventListener("afterprint", onAfterPrint)
  }, [])

  const handlePrint = (target: "trucks" | "trailers") => {
    setPrintTarget(target)
    setTimeout(() => window.print(), 100)
  }

  return (
    <Card
      id="director-summary-matrix"
      data-print-target={printTarget}
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
          #director-summary-matrix[data-print-target="trucks"] [data-print-section="trailers"],
          #director-summary-matrix[data-print-target="trucks"] [data-print-section="trailers"] *,
          #director-summary-matrix[data-print-target="trailers"] [data-print-section="trucks"],
          #director-summary-matrix[data-print-target="trailers"] [data-print-section="trucks"] * {
            display: none !important;
            visibility: hidden !important;
          }
        }
      `}</style>
      <CardHeader>
        <CardTitle>Director&apos;s Summary Matrix</CardTitle>
        <CardDescription>
          Recency map of mechanical interventions, wheel alignments, and
          routine checks for {data.periodLabel}. Print on A1 or A0 landscape.
        </CardDescription>
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
                      "size-3.5 shrink-0 print:size-2.5 [print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
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
          printLabel="Print Trucks"
          printSection="trucks"
          onPrint={() => handlePrint("trucks")}
          hiddenOnPrint={printTarget === "trailers"}
          rows={truckRows}
          systems={DIRECTOR_SUMMARY_SYSTEMS}
          periodLabel={data.periodLabel}
        />
        <DirectorSummaryAssetTable
          title="Trailers (MT)"
          printLabel="Print Trailers"
          printSection="trailers"
          onPrint={() => handlePrint("trailers")}
          hiddenOnPrint={printTarget === "trucks"}
          rows={trailerRows}
          systems={DIRECTOR_SUMMARY_TRAILER_SYSTEMS}
          periodLabel={data.periodLabel}
        />
      </CardContent>
    </Card>
  )
}
