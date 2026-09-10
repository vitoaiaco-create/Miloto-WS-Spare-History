import { auth } from "@clerk/nextjs/server"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { DataUploader } from "@/components/data-uploader"
import { ExportTableMenu } from "@/components/export-table-menu"
import { ShareTableButton } from "@/components/share-table-button"
import { SparesFilterBar } from "@/components/spares-filter-bar"
import { SparesTable } from "@/components/spares-table"
import { Button } from "@/components/ui/button"
import {
  getSparesHistory,
  hasActiveSparesFilters,
  type SparesHistoryFilters,
} from "@/lib/spares-history"

type SearchParams = { [key: string]: string | string[] | undefined }

function toFilterString(value: string | string[] | undefined) {
  return typeof value === "string" ? value : ""
}

export default async function SparesHistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const allowedModules = sessionClaims?.metadata?.modules || []

  if (!allowedModules.includes("spares_history")) {
    redirect("/")
  }

  const resolvedSearchParams = await searchParams

  const filters: SparesHistoryFilters = {
    fleetNo: toFilterString(resolvedSearchParams.fleetNo),
    partNumber: toFilterString(resolvedSearchParams.partNumber),
    materialName: toFilterString(resolvedSearchParams.materialName),
    subEquipment: toFilterString(resolvedSearchParams.subEquipment),
    startDate: toFilterString(resolvedSearchParams.startDate),
    endDate: toFilterString(resolvedSearchParams.endDate),
  }

  const spares = await getSparesHistory(filters)

  return (
    <main className="flex-1 bg-zinc-50 dark:bg-black">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-16 sm:px-10 lg:px-16">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          nativeButton={false}
          render={<Link href="/" />}
        >
          <ArrowLeft data-icon="inline-start" />
          Central Hub
        </Button>

        <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
          Spares History
        </h1>

        <DataUploader />

        <SparesFilterBar initialFilters={filters} />

        <div className="flex items-center justify-end gap-2">
          <ExportTableMenu spares={spares} filters={filters} />
          <ShareTableButton spares={spares} filters={filters} />
        </div>

        <SparesTable spares={spares} isFiltered={hasActiveSparesFilters(filters)} />
      </section>
    </main>
  )
}
