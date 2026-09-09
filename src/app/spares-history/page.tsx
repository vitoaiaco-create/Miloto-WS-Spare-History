import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { DataUploader } from "@/components/data-uploader"
import { SparesFilterBar } from "@/components/spares-filter-bar"
import { SparesTable } from "@/components/spares-table"

export default async function SparesHistoryPage() {
  const { sessionClaims } = await auth()

  const allowedModules = sessionClaims?.metadata?.modules || []

  if (!allowedModules.includes("spares_history")) {
    redirect("/")
  }

  return (
    <main className="flex-1 bg-zinc-50 dark:bg-black">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-16 sm:px-10 lg:px-16">
        <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
          Spares History
        </h1>

        <DataUploader />

        <SparesFilterBar />

        <SparesTable />
      </section>
    </main>
  )
}
