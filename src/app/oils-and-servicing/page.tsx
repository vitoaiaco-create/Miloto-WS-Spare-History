import { auth } from "@clerk/nextjs/server"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { OilHealthTable } from "@/components/oil-health-table"
import { Button } from "@/components/ui/button"
import { getFleetOilHealth } from "@/lib/oil-analytics"

export default async function OilsAndServicingPage() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const allowedModules = sessionClaims?.metadata?.modules || []

  if (!allowedModules.includes("oils_servicing")) {
    redirect("/")
  }

  const rows = await getFleetOilHealth()

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

        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
            Oils &amp; Servicing
          </h1>
          <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
            Dual-clock oil health for the active Miloto fleet: kilometres
            since the last ≥35 L service, top-up burn rate, and kilometres
            since the last lab sample.
          </p>
        </div>

        <OilHealthTable rows={rows} />
      </section>
    </main>
  )
}
