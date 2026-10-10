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
import { formatIsoDate, toIsoDateParam } from "@/lib/iso-date"
import { toCanonicalFleetNumber } from "@/lib/spreadsheet"
import {
  MANUAL_STATEMENT_EVENT_TYPES,
  normalizePartAliasKey,
  type ManualStatementEventType,
} from "@/lib/spares-statement"

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

const optionalOutOfSquare = z.number().finite().nullable().optional()

const createManualEventSchema = z.object({
  assetName: z.string().trim().min(1).max(255),
  date: z
    .string()
    .trim()
    .refine((value) => Boolean(toIsoDateParam(value)), {
      message: "Enter a valid date",
    })
    .refine(
      (value) => {
        const iso = toIsoDateParam(value)
        return iso !== "" && iso <= formatIsoDate(new Date())
      },
      { message: "Date cannot be in the future" }
    ),
  eventType: z.enum(MANUAL_STATEMENT_EVENT_TYPES),
  notes: z.string().trim().max(2000).optional(),
  outOfSquareAxle1: optionalOutOfSquare,
  outOfSquareAxle2: optionalOutOfSquare,
  outOfSquareAxle3: optionalOutOfSquare,
})

type CreateManualEventInput = z.infer<typeof createManualEventSchema>

export type CreateManualEventResult = {
  assetName: string
  date: string
  eventType: ManualStatementEventType
}

export async function createManualStatementEvent(
  input: CreateManualEventInput
): Promise<CreateManualEventResult> {
  await requireSparesHistoryAccess()
  const data = createManualEventSchema.parse(input)
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

  const isWheelAlignment = data.eventType === "WHEEL_ALIGNMENT"

  await db.insert(manualAlignmentEventsTable).values({
    assetId: asset.id,
    date,
    eventType: data.eventType,
    notes: data.notes || null,
    outOfSquareAxle1: isWheelAlignment ? (data.outOfSquareAxle1 ?? null) : null,
    outOfSquareAxle2: isWheelAlignment ? (data.outOfSquareAxle2 ?? null) : null,
    outOfSquareAxle3: isWheelAlignment ? (data.outOfSquareAxle3 ?? null) : null,
  })

  revalidatePath("/spares-history")
  return {
    assetName: asset.assetName,
    date,
    eventType: data.eventType,
  }
}

export async function createManualAlignmentEvent(
  input: Omit<CreateManualEventInput, "eventType"> & {
    eventType?: ManualStatementEventType
  }
): Promise<CreateManualEventResult> {
  return createManualStatementEvent({
    ...input,
    eventType: input.eventType ?? "WHEEL_ALIGNMENT",
  })
}

const updateAlignmentDetailsSchema = z.object({
  eventId: z.number().int().positive(),
  data: z.object({
    outOfSquareAxle1: optionalOutOfSquare,
    outOfSquareAxle2: optionalOutOfSquare,
    outOfSquareAxle3: optionalOutOfSquare,
  }),
})

export type UpdateAlignmentDetailsInput = z.infer<
  typeof updateAlignmentDetailsSchema
>["data"]

export type UpdateAlignmentDetailsResult = {
  eventId: number
  outOfSquareAxle1: number | null
  outOfSquareAxle2: number | null
  outOfSquareAxle3: number | null
}

export async function updateAlignmentDetails(
  eventId: number,
  data: UpdateAlignmentDetailsInput
): Promise<UpdateAlignmentDetailsResult> {
  await requireSparesHistoryAccess()
  const parsed = updateAlignmentDetailsSchema.parse({ eventId, data })

  const [existing] = await db
    .select({
      id: manualAlignmentEventsTable.id,
      eventType: manualAlignmentEventsTable.eventType,
    })
    .from(manualAlignmentEventsTable)
    .where(eq(manualAlignmentEventsTable.id, parsed.eventId))
    .limit(1)

  if (!existing) {
    throw new Error("Event not found")
  }

  if (existing.eventType !== "WHEEL_ALIGNMENT") {
    throw new Error("Only wheel alignment events store out-of-square values")
  }

  const [updated] = await db
    .update(manualAlignmentEventsTable)
    .set({
      outOfSquareAxle1: parsed.data.outOfSquareAxle1 ?? null,
      outOfSquareAxle2: parsed.data.outOfSquareAxle2 ?? null,
      outOfSquareAxle3: parsed.data.outOfSquareAxle3 ?? null,
    })
    .where(eq(manualAlignmentEventsTable.id, parsed.eventId))
    .returning({
      id: manualAlignmentEventsTable.id,
      outOfSquareAxle1: manualAlignmentEventsTable.outOfSquareAxle1,
      outOfSquareAxle2: manualAlignmentEventsTable.outOfSquareAxle2,
      outOfSquareAxle3: manualAlignmentEventsTable.outOfSquareAxle3,
    })

  if (!updated) {
    throw new Error("Event not found")
  }

  revalidatePath("/spares-history")
  return {
    eventId: updated.id,
    outOfSquareAxle1: updated.outOfSquareAxle1,
    outOfSquareAxle2: updated.outOfSquareAxle2,
    outOfSquareAxle3: updated.outOfSquareAxle3,
  }
}

const deleteManualEventSchema = z.number().int().positive()

export type DeleteManualEventResult = {
  eventId: number
}

export async function deleteManualEvent(
  eventId: number
): Promise<DeleteManualEventResult> {
  await requireSparesHistoryAccess()
  const id = deleteManualEventSchema.parse(eventId)

  const deleted = await db
    .delete(manualAlignmentEventsTable)
    .where(eq(manualAlignmentEventsTable.id, id))
    .returning({ id: manualAlignmentEventsTable.id })

  if (deleted.length === 0) {
    throw new Error("Event not found")
  }

  revalidatePath("/spares-history")
  return { eventId: id }
}

