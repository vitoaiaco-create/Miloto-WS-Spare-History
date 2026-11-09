import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { getTodayEvents, getWorkshopEventAssets } from "@/actions/workshop-events"
import { WorkshopEventForm } from "@/components/workshop-event-form"
import { WorkshopEventsTable } from "@/components/workshop-events-table"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { canUseWorkshopEvents } from "@/lib/workshop-events"

export default async function WorkshopEventsPage() {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  // `admin` and `workshop_technician` only.
  if (!canUseWorkshopEvents(sessionClaims?.metadata?.role)) {
    redirect("/")
  }

  const [assets, events] = await Promise.all([
    getWorkshopEventAssets(),
    getTodayEvents(),
  ])

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
        Workshop Events
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Log an event</CardTitle>
          <CardDescription>
            Record a manual wheel alignment or air system check, including
            its pass/fail outcome, against a truck or trailer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkshopEventForm assets={assets} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s events</CardTitle>
          <CardDescription>
            Use Delete for quick corrections. Technicians can delete their own
            events on the day they were logged; admins can delete any event.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkshopEventsTable events={events} />
        </CardContent>
      </Card>
    </>
  )
}
