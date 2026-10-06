"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { DownloadIcon, Loader2Icon } from "lucide-react"

import { commitUnmappedSpare } from "@/actions/triage"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { exportDataToCSV } from "@/lib/export-image"

export type TriageStagingRow = {
  id: number
  assetName: string
  outwardDate: string
  partNumber: string
  materialName: string
  // Raw ERP cells from the daily upload — exported with the triage CSV,
  // not shown as table columns (taxonomy is assigned here instead).
  category: string | null
  subEquipment: string | null
  jobCardNo: string
  // `numeric()` columns come back as strings — see src/db/schema.ts.
  quantity: string
  priceKwacha: string
  createdAt: string
}

export type TriageDictionaryOptions = {
  tier1: string[]
  tier2: string[]
  tier3: string[]
  assetClass: string[]
}

type TaxonomyField = "tier1" | "tier2" | "tier3" | "assetClass"

type RowSelection = {
  tier1: string
  tier2: string
  tier3: string
  assetClass: string
}

const EMPTY_SELECTION: RowSelection = {
  tier1: "",
  tier2: "",
  tier3: "",
  assetClass: "",
}

const FIELD_LABELS: Record<TaxonomyField, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
  assetClass: "Asset Class",
}

// Part Number is a fixed 12rem so Material Name can stick at left-[12rem].
const STICKY_PART_NUMBER_HEAD =
  "sticky top-0 left-0 z-30 w-[12rem] min-w-[12rem] max-w-[12rem] bg-background"
const STICKY_MATERIAL_NAME_HEAD =
  "sticky top-0 left-[12rem] z-30 w-[16rem] min-w-[16rem] max-w-[16rem] bg-background border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
const STICKY_PART_NUMBER_CELL =
  "sticky left-0 z-20 w-[12rem] min-w-[12rem] max-w-[12rem] truncate bg-background font-medium group-hover:bg-muted/50"
const STICKY_MATERIAL_NAME_CELL =
  "sticky left-[12rem] z-20 w-[16rem] min-w-[16rem] max-w-[16rem] truncate bg-background border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] group-hover:bg-muted/50"
const STICKY_HEADER_CELL = "sticky top-0 z-20 bg-background"

function TaxonomySelect({
  field,
  value,
  options,
  disabled,
  onValueChange,
}: {
  field: TaxonomyField
  value: string
  options: string[]
  disabled: boolean
  onValueChange: (value: string) => void
}) {
  const label = FIELD_LABELS[field]

  return (
    <Select
      value={value || undefined}
      onValueChange={(next) => {
        if (typeof next === "string" && next) onValueChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger className="w-40" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function exportPendingRows(rows: TriageStagingRow[]) {
  exportDataToCSV(
    rows.map((row) => ({
      "Part Number": row.partNumber,
      "Material Name": row.materialName,
      "Sub Equipment": row.subEquipment ?? "",
      Category: row.category ?? "",
      Asset: row.assetName,
      "Job Card No": row.jobCardNo,
      "Outward Date": row.outwardDate,
      Qty: row.quantity,
      "Price (K)": row.priceKwacha,
    })),
    "triage-export.csv"
  )
}

// Client Component: renders the pending staging rows handed down by the
// Server Component in src/components/triage-inbox.tsx, tracks each row's
// in-progress Tier 1/2/3 + Asset Class picks locally, and calls
// `commitUnmappedSpare` (src/actions/triage.ts) when "Commit & Learn" is
// pressed.
export function TriageInboxTable({
  rows,
  dictionaryOptions,
}: {
  rows: TriageStagingRow[]
  dictionaryOptions: TriageDictionaryOptions
}) {
  const router = useRouter()
  const [selections, setSelections] = useState<Record<number, RowSelection>>(
    {}
  )
  const [committingId, setCommittingId] = useState<number | null>(null)
  // Rows just committed are hidden immediately rather than waiting on
  // `router.refresh()` to re-render the Server Component with the row
  // gone, so the table doesn't flash the just-submitted row back at the
  // operator for a tick.
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set())

  const visibleRows = rows.filter((row) => !removedIds.has(row.id))

  function updateSelection(rowId: number, field: TaxonomyField, value: string) {
    setSelections((current) => ({
      ...current,
      [rowId]: { ...(current[rowId] ?? EMPTY_SELECTION), [field]: value },
    }))
  }

  function handleExport() {
    if (visibleRows.length === 0) return

    try {
      exportPendingRows(visibleRows)
    } catch (error) {
      toast.add({
        title: "Export failed",
        description:
          error instanceof Error
            ? error.message
            : "Could not export the pending triage rows.",
        type: "error",
      })
    }
  }

  async function handleCommit(row: TriageStagingRow) {
    const selection = selections[row.id] ?? EMPTY_SELECTION

    if (
      !selection.tier1 ||
      !selection.tier2 ||
      !selection.tier3 ||
      !selection.assetClass
    ) {
      toast.add({
        title: "Choose a full taxonomy",
        description:
          "Tier 1, Tier 2, Tier 3 and Asset Class are all required before committing.",
        type: "error",
      })
      return
    }

    setCommittingId(row.id)

    try {
      await commitUnmappedSpare({
        stagingId: row.id,
        tier1: selection.tier1,
        tier2: selection.tier2,
        tier3: selection.tier3,
        assetClass: selection.assetClass,
      })

      setRemovedIds((current) => new Set(current).add(row.id))
      toast.add({
        title: "Committed",
        description: `${row.partNumber} was taught to the master dictionary and added to spares history.`,
        type: "success",
      })
      // The dictionary and spares-history reads are both Server Components,
      // so they only pick up this change once the route re-renders.
      router.refresh()
    } catch (error) {
      toast.add({
        title: "Commit failed",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong committing this row.",
        type: "error",
      })
    } finally {
      setCommittingId(null)
    }
  }

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Triage Inbox</CardTitle>
        <CardDescription>
          Parts from the daily spares upload whose Part Number didn&apos;t
          match the master taxonomy dictionary. Pick a Tier 1, Tier 2, Tier 3
          and Asset Class for each, then Commit &amp; Learn — this teaches
          the dictionary the classification and writes the spare into
          spares history in one step.
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="outline"
            disabled={visibleRows.length === 0}
            onClick={handleExport}
          >
            <DownloadIcon data-icon="inline-start" />
            Export to CSV
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing pending triage.
          </p>
        ) : (
          <Table containerClassName="relative w-full max-h-[70vh] overflow-auto">
            <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_2px_5px_-2px_rgba(0,0,0,0.1)]">
              <TableRow>
                <TableHead className={STICKY_PART_NUMBER_HEAD}>
                  Part Number
                </TableHead>
                <TableHead className={STICKY_MATERIAL_NAME_HEAD}>
                  Material Name
                </TableHead>
                <TableHead className={STICKY_HEADER_CELL}>Asset</TableHead>
                <TableHead className={STICKY_HEADER_CELL}>
                  Job Card No
                </TableHead>
                <TableHead className={STICKY_HEADER_CELL}>
                  Outward Date
                </TableHead>
                <TableHead className={STICKY_HEADER_CELL}>Qty</TableHead>
                <TableHead className={STICKY_HEADER_CELL}>Price (K)</TableHead>
                <TableHead className={STICKY_HEADER_CELL}>Tier 1</TableHead>
                <TableHead className={STICKY_HEADER_CELL}>Tier 2</TableHead>
                <TableHead className={STICKY_HEADER_CELL}>Tier 3</TableHead>
                <TableHead className={STICKY_HEADER_CELL}>
                  Asset Class
                </TableHead>
                <TableHead className={`${STICKY_HEADER_CELL} sr-only`}>
                  Commit
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => {
                const selection = selections[row.id] ?? EMPTY_SELECTION
                const isCommitting = committingId === row.id
                const isReady = Boolean(
                  selection.tier1 &&
                    selection.tier2 &&
                    selection.tier3 &&
                    selection.assetClass
                )

                return (
                  <TableRow key={row.id} className="group">
                    <TableCell
                      className={STICKY_PART_NUMBER_CELL}
                      title={row.partNumber}
                    >
                      {row.partNumber}
                    </TableCell>
                    <TableCell
                      className={STICKY_MATERIAL_NAME_CELL}
                      title={row.materialName}
                    >
                      {row.materialName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.assetName}</Badge>
                    </TableCell>
                    <TableCell>{row.jobCardNo}</TableCell>
                    <TableCell>{row.outwardDate}</TableCell>
                    <TableCell>{row.quantity}</TableCell>
                    <TableCell>{row.priceKwacha}</TableCell>
                    <TableCell>
                      <TaxonomySelect
                        field="tier1"
                        value={selection.tier1}
                        options={dictionaryOptions.tier1}
                        disabled={isCommitting}
                        onValueChange={(value) =>
                          updateSelection(row.id, "tier1", value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TaxonomySelect
                        field="tier2"
                        value={selection.tier2}
                        options={dictionaryOptions.tier2}
                        disabled={isCommitting}
                        onValueChange={(value) =>
                          updateSelection(row.id, "tier2", value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TaxonomySelect
                        field="tier3"
                        value={selection.tier3}
                        options={dictionaryOptions.tier3}
                        disabled={isCommitting}
                        onValueChange={(value) =>
                          updateSelection(row.id, "tier3", value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TaxonomySelect
                        field="assetClass"
                        value={selection.assetClass}
                        options={dictionaryOptions.assetClass}
                        disabled={isCommitting}
                        onValueChange={(value) =>
                          updateSelection(row.id, "assetClass", value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        disabled={!isReady || isCommitting}
                        onClick={() => handleCommit(row)}
                      >
                        {isCommitting ? (
                          <Loader2Icon
                            data-icon="inline-start"
                            className="animate-spin"
                          />
                        ) : null}
                        {isCommitting ? "Committing…" : "Commit & Learn"}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
