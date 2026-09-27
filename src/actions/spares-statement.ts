"use server"

import { auth } from "@clerk/nextjs/server"
import { eq, or } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import {
  assetsTable,
  manualAlignmentEventsTable,
  partDescriptionAliasesTable,
  statementConsumableExclusionsTable,
} from "@/db/schema"
import { toIsoDateParam } from "@/lib/iso-date"
import { toCanonicalFleetNumber } from "@/lib/spreadsheet"
import { normalizePartAliasKey } from "@/lib/spares-statement"

const savePartDescriptionAliasSchema = z.object({
  sourceName: z.string().trim().min(1).max(255),
  alias: z.string().trim().max(255),
})

type SavePartDescriptionAliasInput = z.infer<
  typeof savePartDescriptionAliasSchema
>

export type SavePartDescriptionAliasResult = {
  normalizedName: string
  alias: string | null
}

async function requireSparesHistoryAccess() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    throw new Error("Unauthorized")
  }

  const allowedModules = sessionClaims?.metadata?.modules || []
  if (!allowedModules.includes("spares_history")) {
    throw new Error("Unauthorized")
  }

  return userId
}

export async function savePartDescriptionAlias(
  input: SavePartDescriptionAliasInput
): Promise<SavePartDescriptionAliasResult> {
  const userId = await requireSparesHistoryAccess()
  const data = savePartDescriptionAliasSchema.parse(input)
  const normalizedName = normalizePartAliasKey(data.sourceName)
  const alias = data.alias
  const matchesOriginal =
    alias.length === 0 || normalizePartAliasKey(alias) === normalizedName

  if (matchesOriginal) {
    await db
      .delete(partDescriptionAliasesTable)
      .where(eq(partDescriptionAliasesTable.normalizedName, normalizedName))

    revalidatePath("/spares-history")
    return { normalizedName, alias: null }
  }

  const updatedAt = new Date()

  await db
    .insert(partDescriptionAliasesTable)
    .values({
      sourceName: data.sourceName,
      normalizedName,
      alias,
      updatedAt,
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: partDescriptionAliasesTable.normalizedName,
      set: {
        sourceName: data.sourceName,
        alias,
        updatedAt,
        updatedBy: userId,
      },
    })

  revalidatePath("/spares-history")
  return { normalizedName, alias }
}

const excludeConsumableSchema = z.object({
  partNumber: z.string().trim().min(1).max(100),
  materialName: z.string().trim().min(1).max(255),
})

type ExcludeConsumableInput = z.infer<typeof excludeConsumableSchema>

export type ExcludeConsumableResult = {
  partNumber: string
  materialName: string
}

export async function excludeConsumableFromStatement(
  input: ExcludeConsumableInput
): Promise<ExcludeConsumableResult> {
  const userId = await requireSparesHistoryAccess()
  const data = excludeConsumableSchema.parse(input)
  const normalizedPartNumber = normalizePartAliasKey(data.partNumber)
  const normalizedMaterialName = normalizePartAliasKey(data.materialName)

  const existing = await db
    .select({ id: statementConsumableExclusionsTable.id })
    .from(statementConsumableExclusionsTable)
    .where(
      or(
        eq(
          statementConsumableExclusionsTable.normalizedPartNumber,
          normalizedPartNumber
        ),
        eq(
          statementConsumableExclusionsTable.normalizedMaterialName,
          normalizedMaterialName
        )
      )
    )
    .limit(1)

  if (existing.length === 0) {
    await db
      .insert(statementConsumableExclusionsTable)
      .values({
        partNumber: data.partNumber,
        materialName: data.materialName,
        normalizedPartNumber,
        normalizedMaterialName,
        createdBy: userId,
      })
      .onConflictDoNothing()
  }

  revalidatePath("/spares-history")
  return {
    partNumber: data.partNumber,
    materialName: data.materialName,
  }
}

const createAlignmentEventSchema = z.object({
  assetName: z.string().trim().min(1).max(255),
  date: z
    .string()
    .trim()
    .refine((value) => Boolean(toIsoDateParam(value)), {
      message: "Enter a valid date",
    }),
  notes: z.string().trim().max(2000).optional(),
})

type CreateAlignmentEventInput = z.infer<typeof createAlignmentEventSchema>

export type CreateAlignmentEventResult = {
  assetName: string
  date: string
}

export async function createManualAlignmentEvent(
  input: CreateAlignmentEventInput
): Promise<CreateAlignmentEventResult> {
  await requireSparesHistoryAccess()
  const data = createAlignmentEventSchema.parse(input)
  const date = toIsoDateParam(data.date)
  const assetName = toCanonicalFleetNumber(data.assetName)

  const [asset] = await db
    .select({
      id: assetsTable.id,
      assetName: assetsTable.assetName,
    })
    .from(assetsTable)
    .where(eq(assetsTable.assetName, assetName))
    .limit(1)

  if (!asset) {
    throw new Error("Asset not found")
  }

  await db.insert(manualAlignmentEventsTable).values({
    assetId: asset.id,
    date,
    notes: data.notes || null,
  })

  revalidatePath("/spares-history")
  return {
    assetName: asset.assetName,
    date,
  }
}
