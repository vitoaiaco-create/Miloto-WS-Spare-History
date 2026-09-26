"use server"

import { auth } from "@clerk/nextjs/server"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { assetsTable, monthlyAssetDistancesTable } from "@/db/schema"

const upsertMonthlyManualDistanceSchema = z.object({
  assetId: z.number({ error: "Asset is required" }).int().positive(),
  year: z.number({ error: "Year is required" }).int().min(2000).max(2100),
  month: z
    .number({ error: "Month is required" })
    .int()
    .min(1, "Month must be between 1 and 12")
    .max(12, "Month must be between 1 and 12"),
  // `null` clears the override so scoring falls back to automated hops.
  manualDistance: z
    .number({ error: "Manual distance must be a number" })
    .int("Manual distance must be a whole number")
    .nonnegative("Manual distance cannot be negative")
    .max(200_000, "Manual distance is implausibly high")
    .nullable(),
})

type UpsertMonthlyManualDistanceInput = z.infer<
  typeof upsertMonthlyManualDistanceSchema
>

export type UpsertMonthlyManualDistanceResult = {
  assetId: number
  monthYear: string
  manualDistance: number | null
}

async function requireLogisticsAccess() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    throw new Error("Unauthorized")
  }

  if (sessionClaims?.metadata?.role === "oils_only") {
    throw new Error("Unauthorized")
  }

  const isAdmin = sessionClaims?.metadata?.role === "admin"
  const hasLogisticsModule =
    sessionClaims?.metadata?.modules?.includes("logistics_analytics") ?? false

  if (!isAdmin && !hasLogisticsModule) {
    throw new Error("Unauthorized")
  }
}

function toFirstOfMonthIso(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`
}

// Writes or clears a monthly mileage override. Automated odometer hops in
// `mileage_logs` are left untouched; scoring uses the override when it is
// not null.
export async function upsertMonthlyManualDistance(
  input: UpsertMonthlyManualDistanceInput
): Promise<UpsertMonthlyManualDistanceResult> {
  await requireLogisticsAccess()

  const data = upsertMonthlyManualDistanceSchema.parse(input)
  const monthYear = toFirstOfMonthIso(data.year, data.month)

  const [asset] = await db
    .select({ id: assetsTable.id })
    .from(assetsTable)
    .where(eq(assetsTable.id, data.assetId))
    .limit(1)

  if (!asset) {
    throw new Error("Asset not found")
  }

  if (data.manualDistance === null) {
    await db
      .delete(monthlyAssetDistancesTable)
      .where(
        and(
          eq(monthlyAssetDistancesTable.assetId, data.assetId),
          eq(monthlyAssetDistancesTable.monthYear, monthYear)
        )
      )

    revalidatePath("/logistics")

    return {
      assetId: data.assetId,
      monthYear,
      manualDistance: null,
    }
  }

  const updatedAt = new Date()

  const [row] = await db
    .insert(monthlyAssetDistancesTable)
    .values({
      assetId: data.assetId,
      monthYear,
      manualDistance: data.manualDistance,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        monthlyAssetDistancesTable.assetId,
        monthlyAssetDistancesTable.monthYear,
      ],
      set: {
        manualDistance: data.manualDistance,
        updatedAt,
      },
    })
    .returning({
      assetId: monthlyAssetDistancesTable.assetId,
      monthYear: monthlyAssetDistancesTable.monthYear,
      manualDistance: monthlyAssetDistancesTable.manualDistance,
    })

  if (!row) {
    throw new Error("Failed to save mileage override")
  }

  revalidatePath("/logistics")

  return {
    assetId: row.assetId,
    monthYear: row.monthYear,
    manualDistance: row.manualDistance,
  }
}
