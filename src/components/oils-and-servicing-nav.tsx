"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const SECTIONS = [
  { href: "/oils-and-servicing", label: "Oil Health", match: "home" },
  {
    href: "/oils-and-servicing/pipeline",
    label: "Sampling pipeline",
    match: "pipeline",
  },
  {
    href: "/oils-and-servicing/air-system",
    label: "Air System",
    match: "air-system",
  },
] as const

function sectionFromPath(pathname: string) {
  if (pathname.startsWith("/oils-and-servicing/air-system")) return "air-system"
  if (pathname.startsWith("/oils-and-servicing/pipeline")) return "pipeline"
  return "home"
}

export function OilsAndServicingNav({ className }: { className?: string }) {
  const pathname = usePathname()
  const current = sectionFromPath(pathname)

  return (
    <nav
      aria-label="Oils and servicing sections"
      className={cn(
        "flex h-12 w-full items-center gap-1 overflow-x-auto rounded-lg border bg-background px-2 print:hidden",
        className
      )}
    >
      {SECTIONS.map((section) => {
        const active = current === section.match

        return (
          <Button
            key={section.href}
            variant={active ? "secondary" : "ghost"}
            size="sm"
            nativeButton={false}
            render={<Link href={section.href} />}
            aria-current={active ? "page" : undefined}
          >
            {section.label}
          </Button>
        )
      })}
    </nav>
  )
}
