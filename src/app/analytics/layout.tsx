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
  const hasAnalyticsModule =
    sessionClaims?.metadata?.modules?.includes("workshop_analytics") ?? false

  if (role === "oils_only" || (!isAdmin && !hasAnalyticsModule)) {
    redirect("/")
  }

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
          Workshop Analytics
        </h1>

        <div className="flex w-full items-center gap-3">
          <AnalyticsNav className="min-w-0 flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            nativeButton={false}
            render={<Link href="/analytics/settings" />}
          >
            ⚙️ Settings
          </Button>
        </div>

        {children}
      </section>
    </main>
  )
}
