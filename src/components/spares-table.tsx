"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2Icon, Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { SparesHistoryRow } from "@/lib/spares-history"
import {
  displayMaterialName,
  formatStatementDate,
  formatStatementQty,
  formatStatementUsd,
  groupSparesByAsset,
  statementTotals,
  type PartAliasMap,
  type StatementAssetOption,
} from "@/lib/spares-statement"

const STALE_ODOMETER_DAYS = 14
const MS_PER_DAY = 86_400_000

// Converts the `YYYY-MM-DD` string returned for `date()` columns into the
// `DD-MM-YYYY` display format used throughout this table.
function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-")
  return `${day}-${month}-${year}`
}

// Costs come from the outward report's "Price ($)" and "Amount ($)" columns,
// which the report leaves blank on some lines.
function formatUsd(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function isOdometerStale(latestDate: string) {
  const [year, month, day] = latestDate.split("-").map(Number)
  const latest = new Date(year, month - 1, day)
  const ageDays =
    (startOfLocalDay(new Date()).getTime() - latest.getTime()) / MS_PER_DAY
  return ageDays > STALE_ODOMETER_DAYS
}

function RunningKmCell({
  distance,
  latestDate,
}: {
  distance: number | null
  latestDate: string | null
}) {
  if (distance === null) return "—"

  const formatted = distance.toLocaleString("en-US")
  const stale = latestDate !== null && isOdometerStale(latestDate)

  if (!stale || latestDate === null) return formatted

  const warning = `Warning: Odometer hasn't updated since ${formatDate(latestDate)}`

  return (
    <span className="inline-flex items-center gap-1">
      {formatted}
      <span title={warning} className="inline-flex" aria-label={warning}>
        <AlertTriangle className="size-3.5 text-yellow-500" aria-hidden="true" />
      </span>
    </span>
  )
}

function formatUsdTotal(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

export function SparesTable({
  spares,
  isFiltered,
}: {
  spares: SparesHistoryRow[]
  isFiltered: boolean
}) {
  const totalPrice = spares.reduce(
    (acc, row) => acc + (Number(row.priceUsd) || 0),
    0
  )
  const totalAmount = spares.reduce(
    (acc, row) => acc + (Number(row.amountUsd) || 0),
    0
  )

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Outward Date</TableHead>
          <TableHead>Material Name</TableHead>
          <TableHead>Identity No</TableHead>
          <TableHead>Part Number</TableHead>
          <TableHead>Sub Equipment</TableHead>
          <TableHead>Quantity</TableHead>
          <TableHead>Price ($)</TableHead>
          <TableHead>Amount ($)</TableHead>
          <TableHead>Running KM</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {spares.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={9}
              className="text-center text-muted-foreground"
            >
              {isFiltered
                ? "No spares history matches the selected filters."
                : "Set a filter above to view spares history."}
            </TableCell>
          </TableRow>
        ) : (
          spares.map((spare) => (
            <TableRow key={spare.id}>
              <TableCell>{formatDate(spare.fitmentDate)}</TableCell>
              <TableCell>{spare.materialName}</TableCell>
              <TableCell>{spare.identityNo}</TableCell>
              <TableCell>{spare.partNumber}</TableCell>
              <TableCell>{spare.subEquipment}</TableCell>
              <TableCell>{spare.quantity}</TableCell>
              <TableCell>{formatUsd(spare.priceUsd)}</TableCell>
              <TableCell>{formatUsd(spare.amountUsd)}</TableCell>
              <TableCell>
                <RunningKmCell
                  distance={spare.distance}
                  latestDate={spare.latestDate}
                />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
      {spares.length > 0 ? (
        <TableFooter>
          <TableRow className="border-t-2 bg-muted/50 font-bold hover:bg-muted/50">
            <TableCell colSpan={6}>Total</TableCell>
            <TableCell>{formatUsdTotal(totalPrice)}</TableCell>
            <TableCell>{formatUsdTotal(totalAmount)}</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      ) : null}
    </Table>
  )
}

const STATEMENT_COLUMNS = 6

export function SparesStatementTable({
  spares,
  assets,
  aliases,
  onRemove,
  onExcludeAsset,
  onSaveAlias,
  emptyMessage = "No spare issues in this statement period.",
}: {
  spares: SparesHistoryRow[]
  assets: StatementAssetOption[]
  aliases: PartAliasMap
  onRemove: (id: number) => void
  onExcludeAsset: (assetName: string) => void
  onSaveAlias: (sourceName: string, alias: string) => Promise<void>
  emptyMessage?: string
}) {
  const groups = groupSparesByAsset(spares)
  const totals = statementTotals(spares)
  const assetTypeByName = new Map(
    assets.map((asset) => [asset.assetName, asset.assetType])
  )

  if (spares.length === 0) {
    return (
      <Table>
        <TableHeader>
          <StatementColumnHeaders />
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell
              colSpan={STATEMENT_COLUMNS}
              className="text-center text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
  }

  return (
    <div>
      {groups.map((group) => (
        <section
          key={group.name}
          className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800"
        >
          <header className="flex flex-wrap items-end justify-between gap-3 bg-zinc-900 px-6 py-4 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-950">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.16em] uppercase opacity-70">
                {assetTypeByName.get(group.name) ?? "Asset"}
              </p>
              <h3 className="text-lg font-semibold tracking-tight">
                {group.name}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-medium">
                {group.rows.length} intervention
                {group.rows.length === 1 ? "" : "s"} ·{" "}
                {formatStatementQty(group.totalQuantity)} items ·{" "}
                {formatStatementUsd(group.totalAmount)}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="print:hidden border-zinc-500 bg-transparent text-zinc-50 hover:bg-zinc-800 hover:text-zinc-50 dark:border-zinc-400 dark:text-zinc-950 dark:hover:bg-zinc-200"
                aria-label={`Exclude ${group.name} from this statement`}
                onClick={() => onExcludeAsset(group.name)}
              >
                <Trash2 data-icon="inline-start" />
                Exclude asset
              </Button>
            </div>
          </header>
          <Table>
            <TableHeader>
              <StatementColumnHeaders />
            </TableHeader>
            <TableBody>
              {group.rows.map((spare) => (
                <TableRow key={spare.id}>
                  <TableCell>{formatStatementDate(spare.fitmentDate)}</TableCell>
                  <TableCell className="whitespace-normal">
                    <PartAliasCell
                      originalName={spare.materialName}
                      displayName={displayMaterialName(
                        spare.materialName,
                        aliases
                      )}
                      onSave={onSaveAlias}
                    />
                  </TableCell>
                  <TableCell>{spare.partNumber}</TableCell>
                  <TableCell className="text-right">
                    {formatStatementQty(spare.quantity)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatStatementUsd(spare.amountUsd)}
                  </TableCell>
                  <TableCell className="print:hidden">
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove ${spare.materialName} from statement`}
                            onClick={() => onRemove(spare.id)}
                          />
                        }
                      >
                        <Trash2 />
                      </TooltipTrigger>
                      <TooltipContent>Remove from this statement</TooltipContent>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="bg-zinc-100 font-semibold hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-900">
                <TableCell colSpan={3}>{group.name} total</TableCell>
                <TableCell className="text-right">
                  {formatStatementQty(group.totalQuantity)}
                </TableCell>
                <TableCell className="text-right">
                  {formatStatementUsd(group.totalAmount)}
                </TableCell>
                <TableCell className="print:hidden" />
              </TableRow>
            </TableFooter>
          </Table>
        </section>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-zinc-900 px-6 py-4 text-sm font-bold dark:border-zinc-100">
        <span>Grand total</span>
        <span>
          {formatStatementQty(totals.quantity)} items ·{" "}
          {formatStatementUsd(totals.amount)}
        </span>
      </div>
    </div>
  )
}

function StatementColumnHeaders() {
  return (
    <TableRow>
      <TableHead>Date</TableHead>
      <TableHead>Material Name</TableHead>
      <TableHead>Part Number</TableHead>
      <TableHead className="text-right">Qty</TableHead>
      <TableHead className="text-right">Amount</TableHead>
      <TableHead className="w-10 print:hidden">
        <span className="sr-only">Remove</span>
      </TableHead>
    </TableRow>
  )
}

function PartAliasCell({
  originalName,
  displayName,
  onSave,
}: {
  originalName: string
  displayName: string
  onSave: (sourceName: string, alias: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(displayName)
  const [saving, setSaving] = useState(false)
  const isAliased = displayName !== originalName
  const fieldId = `alias-${originalName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`

  useEffect(() => {
    if (open) setValue(displayName)
  }, [displayName, open])

  async function commit(next: string) {
    setSaving(true)
    try {
      await onSave(originalName, next)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start gap-1">
      <span>
        <span>{displayName}</span>
        {isAliased ? (
          <span className="mt-0.5 block text-[11px] text-muted-foreground print:hidden">
            ERP: {originalName}
          </span>
        ) : null}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="print:hidden text-muted-foreground"
              aria-label={`Simplify part name for ${originalName}`}
              title="Simplify part name"
            />
          }
        >
          <Pencil />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <PopoverHeader>
            <PopoverTitle>Director-friendly name</PopoverTitle>
            <PopoverDescription>
              Saved aliases are reused on future executive statements.
            </PopoverDescription>
          </PopoverHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId}>Display name</Label>
            <Input
              id={fieldId}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void commit(value)
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Original: {originalName}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            {isAliased ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => void commit(originalName)}
              >
                Reset
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={saving || value.trim().length === 0}
              onClick={() => void commit(value)}
            >
              {saving ? (
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
              ) : null}
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
