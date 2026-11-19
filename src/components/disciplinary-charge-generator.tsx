"use client"

import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react"
import { FileTextIcon, ImageUpIcon, Loader2Icon } from "lucide-react"

import { generateDisciplinaryData } from "@/actions/hr-automation"
import { logDisciplinaryCase } from "@/actions/hr-cases"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { generateDisciplinaryDocx } from "@/lib/disciplinary-docx"
import {
  type DisciplinaryCaseField,
  type DisciplinaryData,
  type DisciplinaryField,
  type DisciplinaryTemplateKey,
} from "@/lib/hr-disciplinary"
import { cn } from "@/lib/utils"

const ACCEPTED_TYPES = ["image/jpeg", "image/png"]
const MAX_FILE_BYTES = 7 * 1024 * 1024

type FieldConfig = {
  name: DisciplinaryField | DisciplinaryCaseField
  label: string
  multiline?: boolean
}

const FIELDS: FieldConfig[] = [
  { name: "case_ref", label: "Case Ref" },
  { name: "fleet_id", label: "Fleet ID" },
  { name: "driver_name", label: "Driver name" },
  { name: "employee_no", label: "Employee no." },
  { name: "date", label: "Date" },
  { name: "incident_details", label: "Incident details", multiline: true },
  { name: "formatted_charges", label: "Charges (clauses)", multiline: true },
  { name: "penalty_amount", label: "Penalty amount" },
  { name: "deduction_clause", label: "Deduction clause", multiline: true },
]

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") {
        reject(new Error("Could not read the image."))
        return
      }
      // Strip the `data:<mime>;base64,` prefix; the server action adds it.
      resolve(result.slice(result.indexOf(",") + 1))
    }
    reader.onerror = () => reject(new Error("Could not read the image."))
    reader.readAsDataURL(file)
  })
}

export function DisciplinaryChargeGenerator() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [generating, setGenerating] = useState<DisciplinaryTemplateKey | null>(
    null
  )
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [data, setData] = useState<DisciplinaryData | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function processFile(file: File | undefined) {
    if (!file) return

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Only .jpg and .png images are supported.")
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("Image is too large. Please use one under 7 MB.")
      return
    }

    setError(null)
    setData(null)
    setFileName(file.name)
    setIsAnalyzing(true)

    try {
      const base64 = await readAsBase64(file)
      setPreviewUrl(`data:${file.type};base64,${base64}`)
      // Only the plain base64 string crosses the boundary (no File/Event).
      const result = await generateDisciplinaryData(base64)
      if (result.success) {
        setData(result.data)
      } else {
        setError(result.error)
        toast.add({
          title: "Could not analyze the image",
          description: result.error,
          type: "error",
        })
      }
    } catch (err) {
      // Network failures / unexpected rejections only; action errors are
      // returned as `{ success: false, error }`.
      const message =
        err instanceof Error ? err.message : "Could not analyze the image."
      setError(message)
      toast.add({
        title: "Could not analyze the image",
        description: message,
        type: "error",
      })
    } finally {
      setIsAnalyzing(false)
    }
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    void processFile(event.target.files?.[0])
    // Allow re-selecting the same file after an error.
    event.target.value = ""
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    if (isAnalyzing) return
    void processFile(event.dataTransfer.files?.[0])
  }

  function updateField(
    name: DisciplinaryField | DisciplinaryCaseField,
    value: string
  ) {
    setData((current) => (current ? { ...current, [name]: value } : current))
  }

  async function handleGenerate(template: DisciplinaryTemplateKey) {
    if (!data) return

    const caseRef = data.case_ref.trim()
    const fleetId = data.fleet_id.trim()
    if (!caseRef || !fleetId) {
      const missing = [!caseRef && "Case Ref", !fleetId && "Fleet ID"]
        .filter(Boolean)
        .join(" and ")
      toast.add({
        title: "Missing case details",
        description: `${missing} must be filled in before generating a document.`,
        type: "error",
      })
      return
    }

    setGenerating(template)
    try {
      await generateDisciplinaryDocx(template, data)
      toast.add({
        title: "Document generated",
        description: "The .docx file has been downloaded.",
        type: "success",
      })
    } catch (err) {
      toast.add({
        title: "Could not generate document",
        description:
          err instanceof Error ? err.message : "Something went wrong.",
        type: "error",
      })
      return
    } finally {
      setGenerating(null)
    }

    // Log the case right after the download. A logging failure must never
    // undo or block the file the admin already has.
    try {
      const result = await logDisciplinaryCase({
        caseRef,
        fleetId,
        employeeNo: data.employee_no.trim(),
        driverName: data.driver_name.trim(),
        documentPayload: {
          driver_name: data.driver_name,
          employee_no: data.employee_no,
          date: data.date,
          incident_details: data.incident_details,
          formatted_charges: data.formatted_charges,
          penalty_amount: data.penalty_amount,
          deduction_clause: data.deduction_clause,
        },
      })
      if (result.success) {
        toast.add({
          title: "Case logged",
          description: `${caseRef} was logged to the Kanban tracker.`,
          type: "success",
        })
      } else {
        toast.add({
          title: "Could not log case",
          description: result.error,
          type: "error",
        })
      }
    } catch (err) {
      toast.add({
        title: "Could not log case",
        description:
          err instanceof Error ? err.message : "Something went wrong.",
        type: "error",
      })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload charge summary</CardTitle>
          <CardDescription>
            Drop a .jpg or .png image of the charge summary. The AI extracts the
            driver details and matches the incident against the Miloto
            Disciplinary Code.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            role="button"
            tabIndex={0}
            aria-disabled={isAnalyzing}
            onClick={() => !isAnalyzing && inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                if (!isAnalyzing) inputRef.current?.click()
              }
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-input hover:bg-muted/50",
              isAnalyzing && "cursor-not-allowed opacity-60"
            )}
          >
            {isAnalyzing ? (
              <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
            ) : (
              <ImageUpIcon className="size-8 text-muted-foreground" />
            )}
            <p className="text-sm font-medium">
              {isAnalyzing
                ? "Analyzing image against the Disciplinary Code…"
                : "Drag and drop an image here, or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground">
              {fileName && !isAnalyzing ? `${fileName} · ` : ""}
              JPG or PNG, up to 7 MB
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              className="hidden"
              onChange={handleInputChange}
              disabled={isAnalyzing}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader>
            <CardTitle>Review &amp; edit</CardTitle>
            <CardDescription>
              Check the AI-generated text, make any changes, then generate the
              Word documents.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
                <img
                  src={previewUrl}
                  alt="Uploaded charge summary"
                  className="max-h-96 w-full rounded-lg border object-contain"
                />
              )}

              <div className="flex flex-col gap-4">
                {FIELDS.map(({ name, label, multiline }) => (
                  <div key={name} className="flex flex-col gap-2">
                    <Label htmlFor={name}>{label}</Label>
                    {multiline ? (
                      <Textarea
                        id={name}
                        value={data[name]}
                        rows={name === "incident_details" ? 6 : 3}
                        onChange={(event) =>
                          updateField(name, event.target.value)
                        }
                      />
                    ) : (
                      <Input
                        id={name}
                        value={data[name]}
                        onChange={(event) =>
                          updateField(name, event.target.value)
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => void handleGenerate("charge")}
                disabled={generating !== null}
              >
                {generating === "charge" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <FileTextIcon />
                )}
                Generate Notice of Charge
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleGenerate("penalty")}
                disabled={generating !== null}
              >
                {generating === "penalty" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <FileTextIcon />
                )}
                Generate Notice of Penalty
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
