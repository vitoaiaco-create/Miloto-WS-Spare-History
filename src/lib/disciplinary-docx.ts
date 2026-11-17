import Docxtemplater from "docxtemplater"
import { saveAs } from "file-saver"
import PizZip from "pizzip"

import {
  DISCIPLINARY_TEMPLATES,
  type DisciplinaryData,
  type DisciplinaryTemplateKey,
} from "@/lib/hr-disciplinary"

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

// Windows/macOS-illegal filename characters.
function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim()
}

type TemplateError = Error & {
  properties?: { errors?: Array<{ message?: string }> }
}

function describeTemplateError(error: unknown) {
  const errors = (error as TemplateError)?.properties?.errors
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e) => e.message ?? "Unknown template error").join("; ")
  }
  return error instanceof Error ? error.message : "Unknown template error"
}

// Fetches the requested template from /public/templates, injects the
// reviewed data into its `{{ }}` tags and downloads the finished .docx.
export async function generateDisciplinaryDocx(
  templateKey: DisciplinaryTemplateKey,
  data: DisciplinaryData
) {
  const { file, suffix } = DISCIPLINARY_TEMPLATES[templateKey]

  const response = await fetch(`/templates/${encodeURIComponent(file)}`)
  if (!response.ok) {
    throw new Error(
      `Could not load "${file}" (HTTP ${response.status}). Make sure it exists in public/templates/.`
    )
  }
  const content = await response.arrayBuffer()

  try {
    const zip = new PizZip(content)
    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      // Turn "\n" inside field values into real Word line breaks (needed for
      // formatted_charges, which holds one clause per line).
      linebreaks: true,
      nullGetter: () => "",
    })

    doc.render({ ...data })

    const blob = doc.getZip().generate({
      type: "blob",
      mimeType: DOCX_MIME,
      compression: "DEFLATE",
    })

    const name = safeFileName(data.driver_name) || "Driver"
    saveAs(blob, `${name} - ${suffix}.docx`)
  } catch (error) {
    throw new Error(
      `Could not generate "${file}": ${describeTemplateError(error)}`
    )
  }
}
