"use client"

import Link from "next/link"
import { useSelectedLayoutSegments } from "next/navigation"
import { MenuIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const LOCATION_BY_SEGMENT: Record<string, string> = {
  financials: "Costings / Fleet Financials",
  operations: "Operational Health",
  compliance: "Compliance & Audit",
  "cross-module": "Cross-Module",
  settings: "Settings (Fleet KM)",
}

export function AnalyticsNav({ className }: { className?: string }) {
  const segments = useSelectedLayoutSegments()
  const section = segments[0]
  const isMasterTable = section === "assets" && segments[1] === "table"
  const isAssetCharts = section === "assets" && !isMasterTable
  const currentLocation = isMasterTable
    ? "Costings / Master Costings Table"
    : isAssetCharts
      ? "Costings / Asset Comparison Charts"
      : ((section && LOCATION_BY_SEGMENT[section]) ??
        "Costings / Fleet Financials")

  return (
    <nav
      aria-label="Analytics sections"
      className={cn(
        "flex h-12 w-full items-center justify-between gap-3 rounded-lg border bg-background px-3",
        className
      )}
    >
      <p className="min-w-0 truncate text-sm font-medium text-foreground">
        {currentLocation}
      </p>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Open analytics navigation"
            />
          }
        >
          <MenuIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>COSTINGS</DropdownMenuLabel>
            <DropdownMenuItem
              nativeButton={false}
              render={<Link href="/analytics/financials" />}
              aria-current={section === "financials" ? "page" : undefined}
            >
              Fleet Financials
            </DropdownMenuItem>
            <DropdownMenuItem
              nativeButton={false}
              render={<Link href="/analytics/assets" />}
              aria-current={isAssetCharts ? "page" : undefined}
            >
              Asset Comparison Charts
            </DropdownMenuItem>
            <DropdownMenuItem
              nativeButton={false}
              render={<Link href="/analytics/assets/table" />}
              aria-current={isMasterTable ? "page" : undefined}
            >
              Master Costings Table
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            nativeButton={false}
            render={<Link href="/analytics/operations" />}
            aria-current={section === "operations" ? "page" : undefined}
          >
            Operational Health (Coming Soon)
          </DropdownMenuItem>
          <DropdownMenuItem
            nativeButton={false}
            render={<Link href="/analytics/compliance" />}
            aria-current={section === "compliance" ? "page" : undefined}
          >
            Compliance & Audit (Coming Soon)
          </DropdownMenuItem>
          <DropdownMenuItem
            nativeButton={false}
            render={<Link href="/analytics/cross-module" />}
            aria-current={section === "cross-module" ? "page" : undefined}
          >
            Cross-Module (Coming Soon)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            nativeButton={false}
            render={<Link href="/analytics/settings" />}
            aria-current={section === "settings" ? "page" : undefined}
          >
            Settings (Fleet KM)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
