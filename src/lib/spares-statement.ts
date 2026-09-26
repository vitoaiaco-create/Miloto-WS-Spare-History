import { format } from "date-fns"

import { formatIsoDate } from "@/lib/iso-date"
import { normalizeSubEquipment } from "@/lib/spreadsheet"

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

export const STATEMENT_ASSET_SCOPES = ["All", "Truck", "Trailer"] as const
export type StatementAssetScope = (typeof STATEMENT_ASSET_SCOPES)[number]
export const STATEMENT_ASSET_TYPES = ["Truck", "Trailer"] as const
export type StatementAssetType = (typeof STATEMENT_ASSET_TYPES)[number]

export type StatementAssetOption = {
  assetName: string
  assetType: StatementAssetType
}

export type PartAliasMap = Record<string, string>

export const STATEMENT_COMPONENT_GROUPS = [
  "Air System",
  "Aircon",
  "Axles",
  "Body",
  "Cabin",
  "Chassis",
  "Compressor",
  "Diffs",
  "Electrical",
  "Engine",
  "Hydraulic System",
  "Overhauled Diff",
  "Overhauled Engine",
  "Overhauled Volvo Engine",
  "Service",
  "Suspension",
  "Transmission",
] as const

export type StatementPreviewFilters = {
  categories: string[]
  excludedAssets: string[]
  hiddenIds: number[]
}

export type StatementGroup = {
  name: string
  rows: StatementSpareRow[]
  totalQuantity: number
  totalAmount: number
}

const CONCLUDED_MONTHS = 24
const MONTH_VALUE = /^(\d{4})-(\d{2})$/

export function parseStatementAssetScope(
  value: string | undefined
): StatementAssetScope {
  if (value === "Trailer") return "Trailer"
  if (value === "Truck") return "Truck"
  return "All"
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

export function statementScopeLabel(scope: StatementAssetScope) {
  if (scope === "All") return "All assets"
  return scope === "Trailer" ? "Trailers" : "Trucks"
}

export function statementAssetLabel({
  assetType,
  fleetNo,
  identityNos,
}: {
  assetType: StatementAssetScope
  fleetNo?: string
  identityNos: string[]
}) {
  if (fleetNo) return fleetNo
  if (identityNos.length === 1) return identityNos[0]
  const scope = statementScopeLabel(assetType)
  if (identityNos.length === 0) return scope
  return `${scope} (${identityNos.length})`
}

export function uniqueIdentityNos(rows: StatementSpareRow[]) {
  return [...new Set(rows.map((row) => row.identityNo))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )
}

export function statementAssetKey(identityNo: string) {
  return identityNo.trim() || "Unassigned"
}

export function statementComponentOptions(rows: StatementSpareRow[]) {
  const extras = new Set<string>()
  for (const row of rows) {
    const name = normalizeSubEquipment(row.subEquipment)
    if (
      name &&
      !(STATEMENT_COMPONENT_GROUPS as readonly string[]).includes(name)
    ) {
      extras.add(name)
    }
  }

  return [
    ...STATEMENT_COMPONENT_GROUPS,
    ...[...extras].sort((left, right) => left.localeCompare(right)),
  ]
}

export function statementComponentLabel(categories: string[]) {
  if (categories.length === 0) return "All component groups"
  if (categories.length <= 3) return categories.join(", ")
  return `${categories.length} component groups`
}

export function applyStatementPreviewFilters<T extends StatementSpareRow>(
  rows: T[],
  { categories, excludedAssets, hiddenIds }: StatementPreviewFilters
) {
  const selected = new Set(
    categories.map((category) => normalizeSubEquipment(category)).filter(Boolean)
  )
  const excluded = new Set(excludedAssets)
  const hidden = new Set(hiddenIds)

  return rows.filter((row) => {
    if (hidden.has(row.id)) return false
    if (excluded.has(statementAssetKey(row.identityNo))) return false
    if (selected.size === 0) return true
    return selected.has(normalizeSubEquipment(row.subEquipment))
  })
}

export function normalizePartAliasKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toUpperCase()
}

export function displayMaterialName(
  materialName: string,
  aliases: PartAliasMap
) {
  return aliases[normalizePartAliasKey(materialName)] ?? materialName
}

export function groupSparesByAsset(rows: StatementSpareRow[]): StatementGroup[] {
  const byAsset = new Map<string, StatementSpareRow[]>()

  for (const row of rows) {
    const name = statementAssetKey(row.identityNo)
    const list = byAsset.get(name) ?? []
    list.push(row)
    byAsset.set(name, list)
  }

  return [...byAsset.keys()]
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true })
    )
    .map((name) => {
      const groupRows = [...(byAsset.get(name) ?? [])].sort((left, right) => {
        const dateCmp = left.fitmentDate.localeCompare(right.fitmentDate)
        if (dateCmp !== 0) return dateCmp
        return left.id - right.id
      })

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
  assetType = "All",
  fleetNo = "",
}: {
  period?: string
  assetType?: StatementAssetScope
  fleetNo?: string
} = {}) {
  const params = new URLSearchParams()
  params.set("statement", "1")
  params.set("period", period)
  params.set("assetType", assetType)
  if (fleetNo) params.set("fleetNo", fleetNo)
  return `/spares-history?${params.toString()}`
}
