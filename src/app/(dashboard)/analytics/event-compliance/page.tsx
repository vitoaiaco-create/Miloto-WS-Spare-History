import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { getFleetCompliance } from "@/actions/workshop-events"
import { EventComplianceDashboard } from "@/components/event-compliance-dashboard"
import { toIsoDateParam } from "@/lib/iso-date"
import {
  addWorkshopDays,
  isWorkshopAdmin,
  toWorkshopDay,
  workshopDayStart,
  WORKSHOP_EVENT_CATEGORIES,
  type WorkshopEventCategory,
} from "@/lib/workshop-events"

type SearchParams = { [key: string]: string | string[] | undefined }

const DEFAULT_WINDOW_DAYS = 30

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function EventCompliancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { userId, sessionClaims } = await auth()

  if (!userId) {
    redirect("/sign-in")
  }

  // `admin` only.
  if (!isWorkshopAdmin(sessionClaims?.metadata?.role)) {
    redirect("/")
  }

  const params = await searchParams
  const today = toWorkshopDay()
  const rawFrom = toIsoDateParam(firstParam(params.from))
  const rawTo = toIsoDateParam(firstParam(params.to))
  const rawCategory = firstParam(params.category)

  const category: WorkshopEventCategory =
    WORKSHOP_EVENT_CATEGORIES.find((option) => option === rawCategory) ??
    WORKSHOP_EVENT_CATEGORIES[0]

  let to = rawTo || today
  let from = rawFrom || addWorkshopDays(to, -(DEFAULT_WINDOW_DAYS - 1))
  if (from > to) [from, to] = [to, from]

  const startDate = workshopDayStart(from)
  const endDate = workshopDayStart(to)
  if (!startDate || !endDate) redirect("/analytics/event-compliance")

  const rows = await getFleetCompliance(category, startDate, endDate)

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-black sm:text-4xl dark:text-zinc-50">
          Event Compliance
        </h1>
        <p className="max-w-2xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
          The most recent outcome for every truck and trailer inside the
          selected window. Filter by status to isolate pending or failed
          units.
        </p>
      </div>

      <EventComplianceDashboard
        rows={rows}
        from={from}
        to={to}
        category={category}
      />
    </>
  )
}
