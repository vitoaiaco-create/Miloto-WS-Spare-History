"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon } from "lucide-react"

import { commitUnmappedSpare } from "@/actions/triage"
import { Badge } from "@/components/ui/badge"
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

export type TriageStagingRow = {
  id: number
  assetName: string
  fitmentDate: string
  partNumber: string
  materialName: string
  jobCardNo: string
  // `numeric()` columns come back as strings — see src/db/schema.ts.
  quantity: string
  costKwacha: string
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
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing pending triage.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Part Number</TableHead>
                <TableHead>Material Name</TableHead>
                <TableHead>Job Card No</TableHead>
                <TableHead>Fitment Date</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Amount (K)</TableHead>
                <TableHead>Tier 1</TableHead>
                <TableHead>Tier 2</TableHead>
                <TableHead>Tier 3</TableHead>
                <TableHead>Asset Class</TableHead>
                <TableHead className="sr-only">Commit</TableHead>
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
                  <TableRow key={row.id}>
                    <TableCell>
                      <Badge variant="outline">{row.assetName}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.partNumber}
                    </TableCell>
                    <TableCell>{row.materialName}</TableCell>
                    <TableCell>{row.jobCardNo}</TableCell>
                    <TableCell>{row.fitmentDate}</TableCell>
                    <TableCell>{row.quantity}</TableCell>
                    <TableCell>{row.costKwacha}</TableCell>
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
