import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import {
  Card,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default async function LogisticsAnalyticsPage() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  const role = sessionClaims?.metadata?.role
  const isAdmin = role === "admin"
  const modules = sessionClaims?.metadata?.modules
  const hasWorkshopModule = modules?.includes("workshop_analytics") ?? false
  const hasLogisticsModule = modules?.includes("logistics_analytics") ?? false

  if (
    role === "oils_only" ||
    (!isAdmin && !hasWorkshopModule && !hasLogisticsModule)
  ) {
    redirect("/")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Logistics Analytics &amp; Driver Yields - Under Construction
        </CardTitle>
      </CardHeader>
    </Card>
  )
}
