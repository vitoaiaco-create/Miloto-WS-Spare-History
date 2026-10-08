import { auth } from "@clerk/nextjs/server"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AnalyticsNav } from "@/components/analytics-nav"
import { Button } from "@/components/ui/button"

export default async function AnalyticsLayout({
  children,
}: LayoutProps<"/analytics">) {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const role = sessionClaims?.metadata?.role
  const isAdmin = role === "admin"
  const modules = sessionClaims?.metadata?.modules
  const hasWorkshopModule = modules?.includes("workshop_analytics") ?? false

  if (role === "oils_only" || (!isAdmin && !hasWorkshopModule)) {
    redirect("/")
  }

  return (
    <main className="flex-1 bg-zinc-50 dark:bg-black">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-16 print:max-w-none print:px-4 print:py-0 sm:px-10 lg:px-16">
        <Button
          variant="ghost"
          size="sm"
          className="self-start print:hidden"
          nativeButton={false}
          render={<Link href="/" />}
        >
          <ArrowLeft data-icon="inline-start" />
          Central Hub
        </Button>

        <h1 className="text-3xl font-semibold tracking-tight text-black print:hidden sm:text-4xl dark:text-zinc-50">
          Workshop Analytics
        </h1>

        <AnalyticsNav className="print:hidden" />

        {children}
      </section>
    </main>
  )
}
