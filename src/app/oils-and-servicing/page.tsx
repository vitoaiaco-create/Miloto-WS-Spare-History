import { auth } from "@clerk/nextjs/server"
import { AlertTriangle, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ExportOilHealthMenu } from "@/components/export-table-menu"
import { FleetStatusDonut } from "@/components/fleet-status-donut"
import { OilHealthTable } from "@/components/oil-health-table"
import { ShareTableButton } from "@/components/share-oil-table-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getFleetOilHealth } from "@/lib/oil-analytics"
import {
  CRITICAL_BURN_RATE,
  sortOilHealthByPriority,
} from "@/lib/oil-status"

export default async function OilsAndServicingPage() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const allowedModules = sessionClaims?.metadata?.modules || []

  if (!allowedModules.includes("oils_servicing")) {
    redirect("/")
  }

  const rows = sortOilHealthByPriority(await getFleetOilHealth())
  const criticalBurners = rows.filter(
    (asset): asset is typeof asset & { burnRate: number } =>
      asset.burnRate !== null && asset.burnRate >= CRITICAL_BURN_RATE
  )

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

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
              Oils &amp; Servicing
            </h1>
            <p className="text-base leading-7 text-zinc-600 dark:text-zinc-400">
              For Fleet Preventative Health
            </p>
          </div>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/oils-and-servicing/pipeline" />}
          >
            Sampling pipeline
          </Button>
        </div>

        <FleetStatusDonut rows={rows} />

        {criticalBurners.length > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>CRITICAL: High Oil Consumption Detected</AlertTitle>
            <AlertDescription>
              {criticalBurners.map((asset) => (
                <p key={asset.assetId}>
                  {asset.assetName} is burning{" "}
                  {asset.burnRate.toLocaleString("en-US", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}{" "}
                  L / 1,000km
                </p>
              ))}
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex w-full flex-col items-center justify-between gap-4 sm:flex-row">
              <CardTitle>Priority roster</CardTitle>
              <div className="flex items-center gap-2">
                <ExportOilHealthMenu rows={rows} />
                <ShareTableButton />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <OilHealthTable rows={rows} />
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
