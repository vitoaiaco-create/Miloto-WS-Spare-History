import { auth } from "@clerk/nextjs/server"
import { AlertTriangle } from "lucide-react"
import { redirect } from "next/navigation"

import { ExportOilHealthMenu } from "@/components/export-table-menu"
import { FleetStatusDonut } from "@/components/fleet-status-donut"
import { OilHealthTable } from "@/components/oil-health-table"
import { ShareTableButton } from "@/components/share-oil-table-button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  const role = sessionClaims?.metadata?.role
  const isOilsOnly = role === "oils_only"

  if (!isOilsOnly && !allowedModules.includes("oils_servicing")) {
    redirect("/")
  }

  const rows = sortOilHealthByPriority(await getFleetOilHealth())
  const criticalBurners = rows.filter(
    (asset): asset is typeof asset & { burnRate: number } =>
      asset.burnRate !== null && asset.burnRate >= CRITICAL_BURN_RATE
  )

  return (
    <>
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
    </>
  )
}
