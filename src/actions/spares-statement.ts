"use server"

import { auth } from "@clerk/nextjs/server"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { db } from "@/db"
import { partDescriptionAliasesTable } from "@/db/schema"
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
