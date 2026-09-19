"use client"

import { useState, type FormEvent } from "react"
import { usePathname, useRouter } from "next/navigation"

import { upsertMonthlyFleetKm } from "@/actions/analytics"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"

function parseFleetKm(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === "") return null

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null

  return parsed
}

function parseSelectedMonth(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null

  return { year, month }
}

export function FleetKmForm({ selectedMonth }: { selectedMonth: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [fleetKmInput, setFleetKmInput] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const fleetKm = parseFleetKm(fleetKmInput)

  function onSelectedMonthChange(value: string) {
    router.replace(value ? `${pathname}?month=${value}` : pathname, {
      scroll: false,
    })
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const monthParts = parseSelectedMonth(selectedMonth)
    if (!monthParts) {
      toast.add({
        title: "Choose a month",
        description: "Select the calendar month this fleet KM total belongs to.",
        type: "error",
      })
      return
    }

    if (fleetKm === null || !Number.isInteger(fleetKm) || fleetKm < 0) {
      toast.add({
        title: "Enter total fleet KM",
        description: "Total Fleet KM must be a whole number of 0 or more.",
        type: "error",
      })
      return
    }

    setIsSaving(true)

    try {
      const row = await upsertMonthlyFleetKm({
        year: monthParts.year,
        month: monthParts.month,
        totalKm: fleetKm,
      })

      toast.add({
        title: "Fleet KM saved",
        description: `Stored ${row.totalKm.toLocaleString()} km for ${selectedMonth}.`,
        type: "success",
      })
    } catch (error) {
      toast.add({
        title: "Could not save fleet KM",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while saving the monthly fleet KM.",
        type: "error",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Total Fleet KM</CardTitle>
        <CardDescription>
          Enter the fleet-wide kilometres for a calendar month. Saving
          overwrites any total already stored for that month.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="analytics-month">Month</Label>
            <Input
              id="analytics-month"
              type="month"
              value={selectedMonth}
              onChange={(event) => onSelectedMonthChange(event.target.value)}
              required
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label htmlFor="analytics-fleet-km">Total Fleet KM</Label>
            <Input
              id="analytics-fleet-km"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="e.g. 125000"
              value={fleetKmInput}
              onChange={(event) => setFleetKmInput(event.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
