import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { getDisciplinaryCases } from "@/actions/hr-cases"
import { DisciplinaryWorkspace } from "@/components/disciplinary-workspace"

export default async function DisciplinaryChargesPage() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  // Disciplinary charges are admin-only.
  if (sessionClaims?.metadata?.role !== "admin") {
    redirect("/")
  }

  const result = await getDisciplinaryCases()

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
        Automated HR Charges
      </h1>

      <DisciplinaryWorkspace
        initialCases={result.success ? result.data : []}
        initialError={result.success ? undefined : result.error}
      />
    </>
  )
}
