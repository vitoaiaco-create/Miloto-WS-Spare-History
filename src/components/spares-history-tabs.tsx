"use client"

import { useRouter } from "next/navigation"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function SparesHistoryTabs({
  active,
  directorSummaryHref,
}: {
  active: "history" | "director-summary"
  directorSummaryHref: string
}) {
  const router = useRouter()

  return (
    <Tabs
      value={active}
      onValueChange={(value) => {
        if (value === "director-summary") {
          router.push(directorSummaryHref)
          return
        }
        if (value === "history") {
          router.push("/spares-history")
        }
      }}
      className="print:hidden"
    >
      <TabsList className="h-9 w-full max-w-md justify-start">
        <TabsTrigger className="px-3" value="history">
          Spares History
        </TabsTrigger>
        <TabsTrigger className="px-3" value="director-summary">
          Director&apos;s Summary
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
