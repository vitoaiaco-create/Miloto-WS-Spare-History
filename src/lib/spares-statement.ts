import { format } from "date-fns"

import { formatIsoDate } from "@/lib/iso-date"

// The fields the statement layout and exports actually use. Compatible
// with `SparesHistoryRow` without importing the server-only history module.
export type StatementSpareRow = {
  id: number
  fitmentDate: string
  materialName: string
  identityNo: string
  partNumber: string
  subEquipment: string
  quantity: number
  amountUsd: number | null
}

export const STATEMENT_ASSET_TYPES = ["Truck", "Trailer"] as const
export type StatementAssetType = (typeof STATEMENT_ASSET_TYPES)[number]

export type StatementAssetOption = {
  assetName: string
  assetType: StatementAssetType
}

export type StatementGroup = {
  name: string
  rows: StatementSpareRow[]
  totalQuantity: number
  totalAmount: number
}

const CONCLUDED_MONTHS = 24
const MONTH_VALUE = /^(\d{4})-(\d{2})$/

// Preferred director-facing order. Anything else (including new workshop
// categories) sorts alphabetically after these.
const COMPONENT_ORDER = [
  "Engine",
  "Overhauled Engine",
  "Overhauled Volvo Engine",
  "Transmission",
  "Axles",
  "Diffs",
  "Overhauled Diff",
  "Suspension",
  "Brakes",
  "Air System",
  "Electrical",
  "Hydraulic System",
  "Cabin",
  "Chassis",
  "Body",
  "Aircon",
  "Compressor",
  "Service",
]

export function parseStatementAssetType(
  value: string | undefined
): StatementAssetType {
  return value === "Trailer" ? "Trailer" : "Truck"
}

export function isStatementMode(value: string | undefined) {
  return value === "1" || value === "true"
}

export function parseStatementPeriod(value: string | undefined) {
  if (!value || value === "mtd") return "mtd"

  const match = MONTH_VALUE.exec(value)
  if (!match) return "mtd"

  const month = Number(match[2])
  if (month < 1 || month > 12) return "mtd"

  return `${match[1]}-${match[2]}`
}

export function statementDateRange(period: string, today: Date) {
  if (period === "mtd") {
    return {
      startDate: formatIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
      endDate: formatIsoDate(today),
    }
  }

  const [year, month] = period.split("-").map(Number)
  return {
    startDate: `${year}-${String(month).padStart(2, "0")}-01`,
    endDate: formatIsoDate(new Date(year, month, 0)),
  }
}

export function statementPeriodOptions(today: Date) {
  const options = [
    {
      value: "mtd",
      label: `${format(today, "MMMM yyyy")} (MTD)`,
    },
  ]

  for (let offset = 1; offset <= CONCLUDED_MONTHS; offset += 1) {
    const month = new Date(today.getFullYear(), today.getMonth() - offset, 1)
    options.push({
      value: format(month, "yyyy-MM"),
      label: format(month, "MMMM yyyy"),
    })
  }

  return options
}

export function statementPeriodLabel(period: string, today: Date) {
  const option = statementPeriodOptions(today).find((item) => item.value === period)
  if (option) return option.label

  if (period === "mtd") return `${format(today, "MMMM yyyy")} (MTD)`

  const [year, month] = period.split("-").map(Number)
  if (!year || !month) return period
  return format(new Date(year, month - 1, 1), "MMMM yyyy")
}

export function formatStatementDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-")
  return `${day}-${month}-${year}`
}

export function formatStatementUsd(value: number | null) {
  if (value === null) return "—"
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

export function formatStatementQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function classifyStatementAssetType(
  assetType: string,
  assetName: string
): StatementAssetType | null {
  const type = assetType.trim().toLowerCase()
  const name = assetName.trim().toUpperCase()

  if (
    type === "trailer" ||
    name.includes("TRAILER") ||
    /^MT\d+$/.test(name)
  ) {
    return "Trailer"
  }

  if (
    type === "truck" ||
    type === "prime mover" ||
    type === "tow truck" ||
    type === "crane" ||
    /^MTL\d+$/.test(name) ||
    /^CM\d+$/.test(name) ||
    name.includes("TOW")
  ) {
    return "Truck"
  }

  return null
}

export function assetTypesForStatement(assetType: StatementAssetType) {
  return assetType === "Trailer"
    ? ["Trailer"]
    : ["Prime Mover", "Truck", "Tow Truck", "Crane"]
}

export function statementAssetLabel({
  assetType,
  fleetNo,
  identityNos,
}: {
  assetType: StatementAssetType
  fleetNo?: string
  identityNos: string[]
}) {
  if (fleetNo) return fleetNo
  if (identityNos.length === 1) return identityNos[0]
  if (identityNos.length === 0) return `All ${assetType}s`
  return `All ${assetType}s (${identityNos.length})`
}

export function uniqueIdentityNos(rows: StatementSpareRow[]) {
  return [...new Set(rows.map((row) => row.identityNo))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )
}

export function groupSparesByComponent(
  rows: StatementSpareRow[]
): StatementGroup[] {
  const byName = new Map<string, StatementSpareRow[]>()

  for (const row of rows) {
    const name = row.subEquipment.trim() || "Uncategorized"
    const list = byName.get(name) ?? []
    list.push(row)
    byName.set(name, list)
  }

  return [...byName.keys()]
    .sort((left, right) => {
      const leftIndex = COMPONENT_ORDER.indexOf(left)
      const rightIndex = COMPONENT_ORDER.indexOf(right)
      if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right)
      if (leftIndex === -1) return 1
      if (rightIndex === -1) return -1
      return leftIndex - rightIndex
    })
    .map((name) => {
      const groupRows = byName.get(name) ?? []
      return {
        name,
        rows: groupRows,
        totalQuantity: groupRows.reduce((sum, row) => sum + row.quantity, 0),
        totalAmount: groupRows.reduce(
          (sum, row) => sum + (Number(row.amountUsd) || 0),
          0
        ),
      }
    })
}

export function statementTotals(rows: StatementSpareRow[]) {
  return {
    quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    amount: rows.reduce((sum, row) => sum + (Number(row.amountUsd) || 0), 0),
  }
}

export function sparesStatementHref({
  period = "mtd",
  assetType = "Truck",
  fleetNo = "",
}: {
  period?: string
  assetType?: StatementAssetType
  fleetNo?: string
} = {}) {
  const params = new URLSearchParams()
  params.set("statement", "1")
  params.set("period", period)
  params.set("assetType", assetType)
  if (fleetNo) params.set("fleetNo", fleetNo)
  return `/spares-history?${params.toString()}`
}
