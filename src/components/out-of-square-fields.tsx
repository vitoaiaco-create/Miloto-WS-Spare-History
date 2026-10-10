"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  outOfSquareAxleFields,
  type OutOfSquareAxleKey,
  type StatementAssetType,
} from "@/lib/spares-statement"

export type OutOfSquareFieldValues = Record<OutOfSquareAxleKey, string>

export const EMPTY_OUT_OF_SQUARE_VALUES: OutOfSquareFieldValues = {
  outOfSquareAxle1: "",
  outOfSquareAxle2: "",
  outOfSquareAxle3: "",
}

export function metricToFieldValue(value: number | null | undefined) {
  return value == null ? "" : String(value)
}

export function OutOfSquareFields({
  assetType,
  values,
  onChange,
  idPrefix,
}: {
  assetType: StatementAssetType
  values: OutOfSquareFieldValues
  onChange: (key: OutOfSquareAxleKey, value: string) => void
  idPrefix: string
}) {
  return (
    <div className="grid gap-3">
      <p className="text-sm font-medium">Out of Square (mm/m)</p>
      {outOfSquareAxleFields(assetType).map((field) => (
        <div key={field.key} className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-${field.key}`}>{field.label}</Label>
          <Input
            id={`${idPrefix}-${field.key}`}
            type="number"
            step="any"
            inputMode="decimal"
            value={values[field.key]}
            onChange={(event) => onChange(field.key, event.target.value)}
            placeholder="e.g. -2.9"
          />
        </div>
      ))}
    </div>
  )
}
