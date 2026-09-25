"use client"

import Link from "next/link"

import { cn } from "@/lib/utils"

export function LogisticsNav({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-6 print:hidden", className)}>
      <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
        Logistics Analytics
      </h1>

      <nav
        aria-label="Logistics sections"
        className="flex h-12 w-full items-center rounded-lg border bg-background px-3"
      >
        <Link
          href="/logistics"
          aria-current="page"
          className="text-sm font-medium text-foreground"
        >
          Asset Yield Matrix
        </Link>
      </nav>
    </div>
  )
}
