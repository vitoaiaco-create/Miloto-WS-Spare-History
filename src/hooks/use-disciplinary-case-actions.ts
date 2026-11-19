"use client"

import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"

import {
  deleteDisciplinaryCase,
  updateDisciplinaryCase,
} from "@/actions/hr-cases"
import { toast } from "@/components/ui/toast"
import { generateDisciplinaryDocx } from "@/lib/disciplinary-docx"
import {
  buildDocumentData,
  type DisciplinaryCase,
  type HrDisciplinaryStatus,
} from "@/lib/disciplinary-cases"
import type { DisciplinaryTemplateKey } from "@/lib/hr-disciplinary"

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong."
}

const caseKey = (id: number) => `case:${id}`
const downloadKey = (id: number, template: DisciplinaryTemplateKey) =>
  `docx:${id}:${template}`

// Shared mutations for the Kanban board and the Historical Log. The workspace
// owns the `cases` state; this hook updates it optimistically and rolls back
// when a Server Action reports a failure.
export function useDisciplinaryCaseActions(
  setCases: Dispatch<SetStateAction<DisciplinaryCase[]>>
) {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())

  const setBusyKey = useCallback((key: string, active: boolean) => {
    setBusy((current) => {
      const next = new Set(current)
      if (active) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const patchCase = useCallback(
    (id: number, patch: Partial<DisciplinaryCase>) => {
      setCases((current) =>
        current.map((c) => (c.id === id ? { ...c, ...patch } : c))
      )
    },
    [setCases]
  )

  // Status moves freely forward or backward. `closedAt` is stamped on entering
  // CLOSED and cleared on leaving it, mirroring the Server Action.
  const moveCase = useCallback(
    async (caseItem: DisciplinaryCase, status: HrDisciplinaryStatus) => {
      if (caseItem.status === status) return
      const key = caseKey(caseItem.id)

      const previous = {
        status: caseItem.status,
        closedAt: caseItem.closedAt,
      }
      patchCase(caseItem.id, {
        status,
        closedAt: status === "CLOSED" ? new Date() : null,
      })
      setBusyKey(key, true)

      try {
        const result = await updateDisciplinaryCase(caseItem.id, { status })
        if (!result.success) {
          patchCase(caseItem.id, previous)
          toast.add({
            title: `Could not move ${caseItem.caseRef}`,
            description: result.error,
            type: "error",
          })
        }
      } catch (error) {
        patchCase(caseItem.id, previous)
        toast.add({
          title: `Could not move ${caseItem.caseRef}`,
          description: errorMessage(error),
          type: "error",
        })
      } finally {
        setBusyKey(key, false)
      }
    },
    [patchCase, setBusyKey]
  )

  // Resolves true when the note was saved.
  const saveDisputeNote = useCallback(
    async (caseItem: DisciplinaryCase, note: string) => {
      const key = caseKey(caseItem.id)
      setBusyKey(key, true)

      try {
        const result = await updateDisciplinaryCase(caseItem.id, {
          disputeNote: note,
        })
        if (!result.success) {
          toast.add({
            title: "Could not save dispute note",
            description: result.error,
            type: "error",
          })
          return false
        }
        patchCase(caseItem.id, { disputeNote: note.trim() || null })
        toast.add({
          title: "Dispute note saved",
          description: caseItem.caseRef,
          type: "success",
        })
        return true
      } catch (error) {
        toast.add({
          title: "Could not save dispute note",
          description: errorMessage(error),
          type: "error",
        })
        return false
      } finally {
        setBusyKey(key, false)
      }
    },
    [patchCase, setBusyKey]
  )

  // Resolves true when the case was deleted.
  const deleteCase = useCallback(
    async (caseItem: DisciplinaryCase) => {
      const key = caseKey(caseItem.id)
      setBusyKey(key, true)

      try {
        const result = await deleteDisciplinaryCase(caseItem.id)
        if (!result.success) {
          toast.add({
            title: "Could not delete case",
            description: result.error,
            type: "error",
          })
          return false
        }
        setCases((current) => current.filter((c) => c.id !== caseItem.id))
        toast.add({
          title: "Case deleted",
          description: caseItem.caseRef,
          type: "success",
        })
        return true
      } catch (error) {
        toast.add({
          title: "Could not delete case",
          description: errorMessage(error),
          type: "error",
        })
        return false
      } finally {
        setBusyKey(key, false)
      }
    },
    [setBusyKey, setCases]
  )

  const downloadDocument = useCallback(
    async (caseItem: DisciplinaryCase, template: DisciplinaryTemplateKey) => {
      const key = downloadKey(caseItem.id, template)
      setBusyKey(key, true)

      try {
        await generateDisciplinaryDocx(template, buildDocumentData(caseItem))
        toast.add({
          title: "Document generated",
          description: `${caseItem.caseRef} — the .docx file has been downloaded.`,
          type: "success",
        })
      } catch (error) {
        toast.add({
          title: "Could not generate document",
          description: errorMessage(error),
          type: "error",
        })
      } finally {
        setBusyKey(key, false)
      }
    },
    [setBusyKey]
  )

  return {
    moveCase,
    saveDisputeNote,
    deleteCase,
    downloadDocument,
    // True while a status move / note save / delete is in flight for the case.
    isPending: (id: number) => busy.has(caseKey(id)),
    isDownloading: (id: number, template: DisciplinaryTemplateKey) =>
      busy.has(downloadKey(id, template)),
  }
}

export type DisciplinaryCaseActions = ReturnType<
  typeof useDisciplinaryCaseActions
>
