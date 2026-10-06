"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"

import { commitOrphanTaxonomy } from "@/actions/orphan-taxonomy"
import { Button } from "@/components/ui/button"
import {
  Card,
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

export type OrphanSpareRow = {
  partNumber: string
  materialName: string
}

export type OrphanDictionaryOptions = {
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

// A Part Number alone isn't a unique key here — the orphan list is distinct
// on (Part Number, Material Name), and the same Part Number occasionally
// shows up against more than one historical Material Name spelling — so
// per-row selection/removal state is keyed on both together.
function rowKey(row: OrphanSpareRow) {
  return `${row.partNumber}::${row.materialName}`
}

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

// Client Component: renders the Historical Orphans List handed down by the
// Server Component in src/components/master-dictionary.tsx — every distinct
// Part Number / Material Name combination in `mechanicalSparesTable` that
// the taxonomy backfill (`backfillMechanicalSparesTaxonomy` in
// src/actions/dictionary-seed.ts) couldn't resolve. Tracks each row's
// in-progress Tier 1/2/3 + Asset Class picks locally and calls
// `commitOrphanTaxonomy` (src/actions/orphan-taxonomy.ts) when "Commit" is
// pressed.
export function OrphanSparesTable({
  rows,
  dictionaryOptions,
}: {
  rows: OrphanSpareRow[]
  dictionaryOptions: OrphanDictionaryOptions
}) {
  const router = useRouter()
  const [selections, setSelections] = useState<Record<string, RowSelection>>(
    {}
  )
  const [committingKey, setCommittingKey] = useState<string | null>(null)
  // A commit rewrites every historical row sharing this Part Number, so
  // every orphan row with that same Part Number — not just the one just
  // committed — is hidden immediately rather than waiting on
  // `router.refresh()` to re-render the Server Component with them gone.
  const [resolvedPartNumbers, setResolvedPartNumbers] = useState<Set<string>>(
    new Set()
  )

  const visibleRows = rows.filter(
    (row) => !resolvedPartNumbers.has(row.partNumber)
  )

  function updateSelection(key: string, field: TaxonomyField, value: string) {
    setSelections((current) => ({
      ...current,
      [key]: { ...(current[key] ?? EMPTY_SELECTION), [field]: value },
    }))
  }

  async function handleCommit(row: OrphanSpareRow) {
    const key = rowKey(row)
    const selection = selections[key] ?? EMPTY_SELECTION

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

    setCommittingKey(key)

    try {
      const result = await commitOrphanTaxonomy({
        partNumber: row.partNumber,
        materialName: row.materialName,
        tier1: selection.tier1,
        tier2: selection.tier2,
        tier3: selection.tier3,
        assetClass: selection.assetClass,
      })

      setResolvedPartNumbers((current) => new Set(current).add(row.partNumber))
      toast.add({
        title: "Committed",
        description: `${row.partNumber} was taught to the master dictionary and ${result.sparesUpdated.toLocaleString()} historical spare record${
          result.sparesUpdated === 1 ? "" : "s"
        } were updated.`,
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
      setCommittingKey(null)
    }
  }

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Historical Orphans</CardTitle>
        <CardDescription>
          Distinct Part Number / Material Name combinations in the spares
          history whose Asset Class is still NULL, whose Tier 1 doesn&apos;t
          follow the standard format, or whose Part Number has no match in
          the master taxonomy dictionary. Pick a Tier 1, Tier 2, Tier 3 and
          Asset Class for each, then Commit — this teaches the dictionary the
          classification and rewrites every historical spare with that Part
          Number in one step.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No orphaned parts remaining — the taxonomy backfill has nothing
            left to clean up.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part Number</TableHead>
                <TableHead>Material Name</TableHead>
                <TableHead>Tier 1</TableHead>
                <TableHead>Tier 2</TableHead>
                <TableHead>Tier 3</TableHead>
                <TableHead>Asset Class</TableHead>
                <TableHead className="sr-only">Commit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => {
                const key = rowKey(row)
                const selection = selections[key] ?? EMPTY_SELECTION
                const isCommitting = committingKey === key
                const isReady = Boolean(
                  selection.tier1 &&
                    selection.tier2 &&
                    selection.tier3 &&
                    selection.assetClass
                )

                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">
                      {row.partNumber}
                    </TableCell>
                    <TableCell>{row.materialName}</TableCell>
                    <TableCell>
                      <TaxonomySelect
                        field="tier1"
                        value={selection.tier1}
                        options={dictionaryOptions.tier1}
                        disabled={isCommitting}
                        onValueChange={(value) =>
                          updateSelection(key, "tier1", value)
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
                          updateSelection(key, "tier2", value)
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
                          updateSelection(key, "tier3", value)
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
                          updateSelection(key, "assetClass", value)
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
                        {isCommitting ? "Committing…" : "Commit"}
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
