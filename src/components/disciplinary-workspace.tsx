"use client"

import { useCallback, useState } from "react"

import { getDisciplinaryCases } from "@/actions/hr-cases"
import { DisciplinaryChargeGenerator } from "@/components/disciplinary-charge-generator"
import { DisciplinaryHistoryTable } from "@/components/disciplinary-history-table"
import { DisciplinaryKanban } from "@/components/disciplinary-kanban"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/toast"
import { useDisciplinaryCaseActions } from "@/hooks/use-disciplinary-case-actions"
import {
  countActiveCases,
  type DisciplinaryCase,
} from "@/lib/disciplinary-cases"

type TabValue = "generate" | "kanban" | "history"

export function DisciplinaryWorkspace({
  initialCases,
  initialError,
}: {
  initialCases: DisciplinaryCase[]
  initialError?: string
}) {
  const [tab, setTab] = useState<TabValue>("generate")
  const [cases, setCases] = useState(initialCases)
  const actions = useDisciplinaryCaseActions(setCases)

  const refreshCases = useCallback(async () => {
    try {
      const result = await getDisciplinaryCases()
      if (result.success) {
        setCases(result.data)
      } else {
        toast.add({
          title: "Could not refresh cases",
          description: result.error,
          type: "error",
        })
      }
    } catch (error) {
      toast.add({
        title: "Could not refresh cases",
        description:
          error instanceof Error ? error.message : "Something went wrong.",
        type: "error",
      })
    }
  }, [])

  function handleTabChange(value: unknown) {
    if (value !== "generate" && value !== "kanban" && value !== "history") {
      return
    }
    setTab(value)
    // Always show fresh data when opening the tracker or the log.
    if (value !== "generate") void refreshCases()
  }

  return (
    <div className="flex flex-col gap-6">
      {initialError && (
        <Alert variant="destructive">
          <AlertTitle>Could not load cases</AlertTitle>
          <AlertDescription>{initialError}</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={handleTabChange} className="gap-4">
        <TabsList className="h-9 w-full max-w-xl justify-start">
          <TabsTrigger className="px-3" value="generate">
            Generate Charge
          </TabsTrigger>
          <TabsTrigger className="px-3" value="kanban">
            Kanban Tracker
            <Badge variant="secondary" title="Active cases">
              {countActiveCases(cases)}
            </Badge>
          </TabsTrigger>
          <TabsTrigger className="px-3" value="history">
            Historical Log
            <Badge variant="secondary" title="Total cases">
              {cases.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* Kept mounted so an in-progress charge isn't lost when switching tabs. */}
        <TabsContent value="generate" keepMounted>
          <DisciplinaryChargeGenerator
            onCaseLogged={() => void refreshCases()}
          />
        </TabsContent>

        <TabsContent value="kanban">
          <DisciplinaryKanban cases={cases} actions={actions} />
        </TabsContent>

        <TabsContent value="history">
          <DisciplinaryHistoryTable cases={cases} actions={actions} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
