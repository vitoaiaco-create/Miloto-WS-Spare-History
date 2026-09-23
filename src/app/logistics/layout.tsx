import { auth } from "@clerk/nextjs/server"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { LogisticsNav } from "@/components/logistics-nav"
import { Button } from "@/components/ui/button"

export default async function LogisticsLayout({
  children,
}: LayoutProps<"/logistics">) {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const role = sessionClaims?.metadata?.role
  const isAdmin = role === "admin"
  const modules = sessionClaims?.metadata?.modules
  const hasLogisticsModule = modules?.includes("logistics_analytics") ?? false

  if (role === "oils_only" || (!isAdmin && !hasLogisticsModule)) {
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

        <LogisticsNav />

        {children}
      </section>
    </main>
  )
}
