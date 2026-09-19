"use client"

import Link from "next/link"
import { useSelectedLayoutSegment } from "next/navigation"

import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/analytics/financials", segment: "financials", label: "Financials" },
  { href: "/analytics/assets", segment: "assets", label: "Assets" },
  {
    href: "/analytics/operations",
    segment: "operations",
    label: "Operational Health",
  },
  {
    href: "/analytics/compliance",
    segment: "compliance",
    label: "Compliance & Audit",
  },
  {
    href: "/analytics/cross-module",
    segment: "cross-module",
    label: "Cross-Module",
  },
] as const

export function AnalyticsNav({ className }: { className?: string }) {
  const segment = useSelectedLayoutSegment()

  return (
    <nav
      aria-label="Analytics sections"
      className={cn(
        "inline-flex w-full flex-wrap items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground sm:h-12 sm:flex-nowrap",
        className
      )}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = segment === item.segment

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative inline-flex min-h-9 flex-1 items-center justify-center rounded-md border border-transparent px-3 py-1.5 text-center text-sm font-medium whitespace-nowrap transition-all hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring dark:text-muted-foreground dark:hover:text-foreground",
              isActive
                ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground"
                : "text-foreground/60"
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
