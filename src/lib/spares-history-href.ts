// Client-safe URL helper. Kept out of `spares-history.ts` so the Master
// Costings Table can link into Spares History without pulling the Drizzle
// client into the browser bundle.
export function sparesHistoryHref({
  fleetNo,
  subEquipment,
}: {
  fleetNo: string
  subEquipment: string
}) {
  const params = new URLSearchParams()
  params.set("fleetNo", fleetNo)
  params.set("subEquipment", subEquipment)
  return `/spares-history?${params.toString()}`
}
