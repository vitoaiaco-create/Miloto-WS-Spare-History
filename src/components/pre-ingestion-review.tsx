"use client"

import { useMemo, useState } from "react"
import { Loader2Icon } from "lucide-react"

import type {
  PreviewSparePart,
  TaxonomyDictionaryOptions,
} from "@/actions/ingestion"
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
import {
  getTier2Options,
  getTier3Options,
  isCompleteTaxonomyPath,
  sanitizeTaxonomyTiers,
  TIER_1_OPTIONS,
} from "@/lib/taxonomy"

export type ReviewedSpareMapping = {
  partNumber: string
  materialName: string
  tier1: string
  tier2: string
  tier3: string
  assetClass: string
}

type TaxonomyField = "tier1" | "tier2" | "tier3" | "assetClass"

type RowSelection = {
  tier1: string
  tier2: string
  tier3: string
  assetClass: string
}

const FIELD_LABELS: Record<TaxonomyField, string> = {
  tier1: "Tier 1",
  tier2: "Tier 2",
  tier3: "Tier 3",
  assetClass: "Asset Class",
}

// Same sticky geometry as the Triage Inbox table
// (`src/components/triage-inbox-table.tsx`) so Part Number and Material
// Name stay frozen while the taxonomy dropdowns scroll.
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
  allowCustomValue = false,
  onValueChange,
}: {
  field: TaxonomyField
  value: string
  options: string[]
  disabled: boolean
  allowCustomValue?: boolean
  onValueChange: (value: string) => void
}) {
  const label = FIELD_LABELS[field]
  const mergedOptions =
    allowCustomValue && value !== "" && !options.includes(value)
      ? [value, ...options]
      : options
  const selectValue = mergedOptions.includes(value) ? value : ""

  return (
    <Select
      value={selectValue || undefined}
      onValueChange={(next) => {
        if (typeof next === "string" && next) onValueChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger className="w-56" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {mergedOptions.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function initialSelections(parts: PreviewSparePart[]) {
  return Object.fromEntries(
    parts.map((part) => {
      const tiers = sanitizeTaxonomyTiers(part)
      return [
        part.partNumberKey,
        {
          ...tiers,
          assetClass: part.assetClass,
        } satisfies RowSelection,
      ]
    })
  )
}

// Client Component: the Pre-Ingestion Review table shown after
// `parseAndPreviewSpares` returns unique parts. Dropdowns default to the
// Master Dictionary proposal; staff can correct orphans and existing
// mappings before `commitSparesIngestion` writes anything.
export function PreIngestionReview({
  parts,
  dictionaryOptions,
  validRowCount,
  skippedCount,
  isCommitting,
  onApprove,
  onDiscard,
}: {
  parts: PreviewSparePart[]
  dictionaryOptions: TaxonomyDictionaryOptions
  validRowCount: number
  skippedCount: number
  isCommitting: boolean
  onApprove: (mappings: ReviewedSpareMapping[]) => void
  onDiscard: () => void
}) {
  const [selections, setSelections] = useState<Record<string, RowSelection>>(
    () => initialSelections(parts)
  )

  const orphanCount = useMemo(
    () => parts.filter((part) => part.isOrphan).length,
    [parts]
  )

  const incompleteCount = useMemo(
    () =>
      parts.filter((part) => {
        const selection = selections[part.partNumberKey]
        return !isCompleteTaxonomyPath(
          selection?.tier1 ?? "",
          selection?.tier2 ?? "",
          selection?.tier3 ?? ""
        )
      }).length,
    [parts, selections]
  )

  function updateSelection(
    partNumberKey: string,
    field: TaxonomyField,
    value: string
  ) {
    setSelections((current) => {
      const previous = current[partNumberKey] ?? {
        tier1: "",
        tier2: "",
        tier3: "",
        assetClass: "",
      }

      if (field === "tier1") {
        return {
          ...current,
          [partNumberKey]: {
            ...previous,
            tier1: value,
            tier2: "",
            tier3: "",
          },
        }
      }

      if (field === "tier2") {
        return {
          ...current,
          [partNumberKey]: {
            ...previous,
            tier2: value,
            tier3: "",
          },
        }
      }

      return {
        ...current,
        [partNumberKey]: {
          ...previous,
          [field]: value,
        },
      }
    })
  }

  function handleApprove() {
    onApprove(
      parts.map((part) => {
        const selection = selections[part.partNumberKey]
        return {
          partNumber: part.partNumberKey,
          materialName: part.materialName,
          tier1: selection?.tier1 ?? part.tier1,
          tier2: selection?.tier2 ?? part.tier2,
          tier3: selection?.tier3 ?? part.tier3,
          assetClass: selection?.assetClass ?? part.assetClass,
        }
      })
    )
  }

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Pre-Ingestion Review</CardTitle>
        <CardDescription>
          {parts.length.toLocaleString()} unique part
          {parts.length === 1 ? "" : "s"} across{" "}
          {validRowCount.toLocaleString()} transaction
          {validRowCount === 1 ? "" : "s"}
          {orphanCount > 0
            ? ` — ${orphanCount} orphan${orphanCount === 1 ? "" : "s"} still need a mapping`
            : ""}
          {incompleteCount > 0
            ? ` — ${incompleteCount} part${incompleteCount === 1 ? "" : "s"} still need a complete Tier 1 / 2 / 3 path`
            : ""}
          {skippedCount > 0
            ? `. ${skippedCount} source row${skippedCount === 1 ? "" : "s"} failed validation and will be skipped.`
            : "."}{" "}
          Review the proposed Tier 1 / 2 / 3 and Asset Class, then Approve
          &amp; Ingest to teach the dictionary and write the transactions.
        </CardDescription>
        <CardAction className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isCommitting}
            onClick={onDiscard}
          >
            Discard
          </Button>
          <Button
            type="button"
            disabled={
              isCommitting || parts.length === 0 || incompleteCount > 0
            }
            onClick={handleApprove}
          >
            {isCommitting ? (
              <Loader2Icon
                data-icon="inline-start"
                className="animate-spin"
              />
            ) : null}
            {isCommitting ? "Ingesting…" : "Approve & Ingest"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {parts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No valid parts were found in this upload.
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
                <TableHead className={STICKY_HEADER_CELL}>Status</TableHead>
                <TableHead className={STICKY_HEADER_CELL}>Rows</TableHead>
                <TableHead className={STICKY_HEADER_CELL}>Tier 1</TableHead>
                <TableHead className={STICKY_HEADER_CELL}>Tier 2</TableHead>
                <TableHead className={STICKY_HEADER_CELL}>Tier 3</TableHead>
                <TableHead className={STICKY_HEADER_CELL}>
                  Asset Class
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parts.map((part) => {
                const selection =
                  selections[part.partNumberKey] ?? {
                    ...sanitizeTaxonomyTiers(part),
                    assetClass: part.assetClass,
                  }
                const tier2Options = getTier2Options(selection.tier1)
                const tier3Options = getTier3Options(
                  selection.tier1,
                  selection.tier2
                )
                const isMapped = isCompleteTaxonomyPath(
                  selection.tier1,
                  selection.tier2,
                  selection.tier3
                )

                return (
                  <TableRow key={part.partNumberKey} className="group">
                    <TableCell
                      className={STICKY_PART_NUMBER_CELL}
                      title={part.partNumber}
                    >
                      {part.partNumber}
                    </TableCell>
                    <TableCell
                      className={STICKY_MATERIAL_NAME_CELL}
                      title={part.materialName}
                    >
                      {part.materialName}
                    </TableCell>
                    <TableCell>
                      {isMapped ? (
                        <Badge variant="outline">Mapped</Badge>
                      ) : (
                        <Badge variant="destructive">
                          {part.isOrphan ? "Orphan" : "Needs mapping"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{part.occurrenceCount}</TableCell>
                    <TableCell>
                      <TaxonomySelect
                        field="tier1"
                        value={selection.tier1}
                        options={TIER_1_OPTIONS}
                        disabled={isCommitting}
                        onValueChange={(value) =>
                          updateSelection(part.partNumberKey, "tier1", value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TaxonomySelect
                        field="tier2"
                        value={selection.tier2}
                        options={tier2Options}
                        disabled={isCommitting || !selection.tier1}
                        onValueChange={(value) =>
                          updateSelection(part.partNumberKey, "tier2", value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TaxonomySelect
                        field="tier3"
                        value={selection.tier3}
                        options={tier3Options}
                        disabled={isCommitting || !selection.tier2}
                        onValueChange={(value) =>
                          updateSelection(part.partNumberKey, "tier3", value)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <TaxonomySelect
                        field="assetClass"
                        value={selection.assetClass}
                        options={dictionaryOptions.assetClass}
                        allowCustomValue
                        disabled={isCommitting}
                        onValueChange={(value) =>
                          updateSelection(
                            part.partNumberKey,
                            "assetClass",
                            value
                          )
                        }
                      />
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
