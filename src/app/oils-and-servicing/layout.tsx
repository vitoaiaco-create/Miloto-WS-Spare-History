import { auth } from "@clerk/nextjs/server"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { OilsAndServicingNav } from "@/components/oils-and-servicing-nav"
import { Button } from "@/components/ui/button"

export default async function OilsAndServicingLayout({
  children,
}: LayoutProps<"/oils-and-servicing">) {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const allowedModules = sessionClaims?.metadata?.modules || []
  const role = sessionClaims?.metadata?.role
  const isOilsOnly = role === "oils_only"

  if (!isOilsOnly && !allowedModules.includes("oils_servicing")) {
    redirect("/")
  }

  return (
    <main className="flex-1 bg-zinc-50 dark:bg-black">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-16 print:max-w-none print:px-4 print:py-0 sm:px-10 lg:px-16">
        {isOilsOnly ? null : (
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
        )}

        <div className="flex flex-col gap-2 print:hidden">
          <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
            Oils &amp; Servicing
          </h1>
          <p className="text-base leading-7 text-zinc-600 dark:text-zinc-400">
            For Fleet Preventative Health
          </p>
        </div>

        <OilsAndServicingNav />

        {children}
      </section>
    </main>
  )
}
