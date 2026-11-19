import { z } from "zod"

// Allowed `hr_disciplinary_cases.status` values. Lives here (not in
// src/db/schema.ts) so Client Components can import it without pulling the
// Drizzle schema into the browser bundle. The DB column is plain text;
// Zod enforces these values in the Server Actions.
export const HR_DISCIPLINARY_STATUSES = [
  "AWAITING_SIGNATURE",
  "DISPUTED",
  "CLOSED",
] as const

export type HrDisciplinaryStatus = (typeof HR_DISCIPLINARY_STATUSES)[number]

// Labels a signed document can be filed under (`hr_disciplinary_attachments
// .doc_label`). Shared by the upload route's Zod validation and the modal.
export const HR_ATTACHMENT_DOC_LABELS = [
  "Signed Notice of Charge",
  "Signed Notice of Penalty",
  "Dispute Statement",
  "Other",
] as const

export type HrAttachmentDocLabel = (typeof HR_ATTACHMENT_DOC_LABELS)[number]

// Upload limits. 4.5 MB is Vercel's request-body limit for functions, so it
// is enforced per file both in the browser and in the upload route.
export const HR_ATTACHMENT_MAX_BYTES = 4.5 * 1024 * 1024
export const HR_ATTACHMENT_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"] as const

// The exact set of fields shared by the AI output, the review form and the
// `{{ }}` tags in the Word templates (MILOTO CHARGE FORM AI.docx and
// MILOTO PENALTY FORM AI.docx). Keep all three in sync.
export const DISCIPLINARY_FIELDS = [
  "driver_name",
  "employee_no",
  "date",
  "incident_details",
  "formatted_charges",
  "penalty_amount",
  "deduction_clause",
] as const

export type DisciplinaryField = (typeof DISCIPLINARY_FIELDS)[number]

// Extra identifiers extracted from the charge screenshot for case tracking
// (`hr_disciplinary_cases.case_ref` / `.fleet_id`). They are NOT template
// tags — the Word templates only use `DISCIPLINARY_FIELDS` above.
export const DISCIPLINARY_CASE_FIELDS = ["case_ref", "fleet_id"] as const

export type DisciplinaryCaseField = (typeof DISCIPLINARY_CASE_FIELDS)[number]

// The model sometimes returns numbers (e.g. a bare penalty amount), so coerce
// every field to a string.
const textField = z.coerce.string().trim()

export const disciplinaryDataSchema = z.object({
  case_ref: textField,
  fleet_id: textField,
  driver_name: textField,
  employee_no: textField,
  date: textField,
  incident_details: textField,
  formatted_charges: textField,
  penalty_amount: textField,
  deduction_clause: textField,
})

export type DisciplinaryData = z.infer<typeof disciplinaryDataSchema>

// Plain-object result returned by the `generateDisciplinaryData` Server Action.
// Errors are returned (never thrown) so no Error instance crosses the
// Client/Server boundary.
export type GenerateDisciplinaryResult =
  | { success: true; data: DisciplinaryData }
  | { success: false; error: string }

export const EMPTY_DISCIPLINARY_DATA: DisciplinaryData = {
  case_ref: "",
  fleet_id: "",
  driver_name: "",
  employee_no: "",
  date: "",
  incident_details: "",
  formatted_charges: "",
  penalty_amount: "",
  deduction_clause: "",
}

// Template files that live in `public/templates/`.
export const DISCIPLINARY_TEMPLATES = {
  charge: {
    file: "MILOTO CHARGE FORM AI.docx",
    suffix: "Notice of Charge",
  },
  penalty: {
    file: "MILOTO PENALTY FORM AI.docx",
    suffix: "Notice of Penalty",
  },
} as const

export type DisciplinaryTemplateKey = keyof typeof DISCIPLINARY_TEMPLATES
