"use client"

import { useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { z } from "zod"

import { logOilSample } from "@/actions/ingestion"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { toast } from "@/components/ui/toast"

const oilSampleFormSchema = z.object({
  assetId: z
    .string()
    .trim()
    .min(1, "Miloto / Asset number is required")
    .max(255, "Miloto / Asset number must be 255 characters or fewer"),
  drawnDate: z.date({ error: "Drawn date is required" }),
  odometer: z
    .number({ error: "Odometer is required" })
    .int("Odometer must be a whole number of kilometres")
    .nonnegative("Odometer cannot be negative"),
})

type OilSampleFormValues = z.infer<typeof oilSampleFormSchema>

export type OilSampleFormProps = {
  defaultAssetId?: string
  onSuccess?: () => void
}

function startOfToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

export function OilSampleForm({
  defaultAssetId = "",
  onSuccess,
}: OilSampleFormProps) {
  const [isDateOpen, setIsDateOpen] = useState(false)
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<OilSampleFormValues>({
    resolver: zodResolver(oilSampleFormSchema),
    defaultValues: {
      assetId: defaultAssetId,
      drawnDate: startOfToday(),
    },
  })

  async function onSubmit(values: OilSampleFormValues) {
    try {
      const result = await logOilSample({
        assetId: values.assetId,
        drawnDate: values.drawnDate,
        odometer: values.odometer,
      })

      toast.add({
        title: "Oil sample logged",
        description: `Sample for ${result.fleetNumber} recorded as drawn.`,
        type: "success",
      })

      reset({
        assetId: "",
        drawnDate: startOfToday(),
      })
      onSuccess?.()
    } catch (error) {
      toast.add({
        title: "Could not log sample",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong while logging the oil sample.",
        type: "error",
      })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log Oil Sample</CardTitle>
        <CardDescription>
          Record a lab sample against a fleet asset. Capture the truck
          odometer at the moment the sample is drawn so the compliance clock
          resets from that exact mileage.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid max-w-3xl grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_220px_160px_auto]"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oil-sample-asset-id">Miloto / Asset number</Label>
            <Input
              id="oil-sample-asset-id"
              placeholder="MTL25"
              autoComplete="off"
              disabled={isSubmitting}
              aria-invalid={errors.assetId ? true : undefined}
              {...register("assetId")}
            />
            {errors.assetId ? (
              <p className="text-sm text-destructive">{errors.assetId.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oil-sample-drawn-date">Drawn date</Label>
            <Controller
              control={control}
              name="drawnDate"
              render={({ field }) => (
                <Popover open={isDateOpen} onOpenChange={setIsDateOpen}>
                  <PopoverTrigger
                    id="oil-sample-drawn-date"
                    disabled={isSubmitting}
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        data-empty={!field.value}
                        className="w-full justify-start font-normal data-[empty=true]:text-muted-foreground"
                        aria-invalid={errors.drawnDate ? true : undefined}
                      />
                    }
                  >
                    <CalendarIcon />
                    {field.value ? (
                      format(field.value, "PPP")
                    ) : (
                      <span>Pick a date</span>
                    )}
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      defaultMonth={field.value}
                      onSelect={(date) => {
                        if (!date) return
                        field.onChange(date)
                        setIsDateOpen(false)
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
            />
            {errors.drawnDate ? (
              <p className="text-sm text-destructive">
                {errors.drawnDate.message}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oil-sample-odometer">Odometer (km)</Label>
            <Input
              id="oil-sample-odometer"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="e.g. 412350"
              autoComplete="off"
              disabled={isSubmitting}
              aria-invalid={errors.odometer ? true : undefined}
              {...register("odometer", { valueAsNumber: true })}
            />
            {errors.odometer ? (
              <p className="text-sm text-destructive">{errors.odometer.message}</p>
            ) : null}
          </div>

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Logging…" : "Log Sample"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
