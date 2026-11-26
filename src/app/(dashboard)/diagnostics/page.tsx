import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { DiagnosticsWorkspace } from "@/components/diagnostics/diagnostics-workspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  getPttDiagnosticsOverview,
  type PttDiagnosticsOverview,
} from "@/lib/ptt-diagnostics-queries"

export default async function FleetDiagnosticsPage() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  // Fleet Diagnostics (PTT Intel) is admin-only, like Automated HR Charges.
  if (sessionClaims?.metadata?.role !== "admin") {
    redirect("/")
  }

  let overview: PttDiagnosticsOverview | null = null
  let loadError: string | null = null

  try {
    overview = await getPttDiagnosticsOverview()
  } catch (error) {
    console.error("[diagnostics] failed to load overview:", error)
    loadError =
      error instanceof Error ? error.message : "Could not load diagnostics."
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
          Fleet Diagnostics (PTT Intel)
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Volvo PTT fault triage, Computer-First SOP directives and fleet scan
          coverage.
        </p>
      </div>

      {overview ? (
        <DiagnosticsWorkspace
          rosterFleetIds={overview.rosterFleetIds}
          rosterTrucks={overview.rosterTrucks}
          sessions={overview.sessions}
          recurringFaults={overview.recurringFaults}
          ledger={overview.ledger}
          exceptions={overview.exceptions}
          workshopKpis={overview.kpis}
        />
      ) : (
        <Alert variant="destructive">
          <AlertTitle>Could not load fleet diagnostics</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
    </>
  )
}
