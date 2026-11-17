"use server"

import { auth } from "@clerk/nextjs/server"
import OpenAI from "openai"
import { z } from "zod"

import {
  disciplinaryDataSchema,
  type DisciplinaryData,
} from "@/lib/hr-disciplinary"
import { MILOTO_DISCIPLINARY_CODE } from "@/lib/miloto-disciplinary-code"

// Raw base64 payload only (no `data:` prefix). Capped to keep Server Action
// bodies sane (see `serverActions.bodySizeLimit` in next.config.ts).
const MAX_BASE64_LENGTH = 10 * 1024 * 1024

const base64ImageSchema = z
  .string({ error: "An image is required" })
  .min(1, { error: "An image is required" })
  .max(MAX_BASE64_LENGTH, { error: "Image is too large" })

export async function generateDisciplinaryData(
  base64Image: string
): Promise<DisciplinaryData> {
  const { userId, sessionClaims } = await auth()
  if (!userId) throw new Error("Unauthorized")
  // HR disciplinary charges are admin-only (matches the page-level gate).
  if (sessionClaims?.metadata?.role !== "admin") throw new Error("Forbidden")

  const image = base64ImageSchema.parse(base64Image)

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured on the server.")
  }

  if (!MILOTO_DISCIPLINARY_CODE.trim()) {
    console.warn(
      "[hr-automation] MILOTO_DISCIPLINARY_CODE is empty; clause matching is not grounded in the official code."
    )
  }

  // Created per call (not at module scope) so a missing key surfaces as a
  // clear action error instead of failing when the module is imported.
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const prompt = `Role: You are a Senior HR Compliance Officer and Fleet Manager for Miloto Transport. You will be provided with an image of a charge summary and the official Miloto Disciplinary Code.

OFFICIAL DISCIPLINARY CODE:
${MILOTO_DISCIPLINARY_CODE}

STEP 1: Extract driver_name, employee_no, and date from the image. Auto-Correct Rule: If the employee_no starts with 'M' (e.g., M121), replace the 'M' with 'D' (e.g., D121). 
STEP 2: Analyze the incident_description. Expand on the likely negligent cause (e.g., 'failure to check mirrors'). Tone: Formal, technical, accusatory. Assign this to 'incident_details'.
STEP 3: Identify ALL applicable disciplinary clauses STRICTLY based on the OFFICIAL DISCIPLINARY CODE. Format exactly as: 'Clause [Number]: [Title]\n'. Assign to 'formatted_charges'.
STEP 4: Extract penalty_amount. Set deduction_clause to: 'Since you have not replied or admitted guilt, the Company has no other option but to recoup the losses by deducting from your wages.'

Output strictly as JSON matching this schema: { driver_name: string, employee_no: string, date: string, incident_details: string, formatted_charges: string, penalty_amount: string, deduction_clause: string }`

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${image}` },
          },
        ],
      },
    ],
  })

  const content = completion.choices[0]?.message?.content
  if (!content) throw new Error("The AI returned an empty response.")

  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    throw new Error("The AI returned invalid JSON. Please try again.")
  }

  const parsed = disciplinaryDataSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      "The AI response did not match the expected format. Please try again."
    )
  }

  // Enforce the auto-correct rule deterministically in case the model missed
  // it: employee numbers like "M121" are really driver numbers ("D121").
  const data = parsed.data
  return {
    ...data,
    employee_no: data.employee_no.replace(/^M(?=\d)/i, "D"),
  }
}
