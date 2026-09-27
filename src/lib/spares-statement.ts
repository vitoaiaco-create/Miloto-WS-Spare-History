import { format } from "date-fns"

import { formatIsoDate } from "@/lib/iso-date"
import {
  normalizeSubEquipment,
  toCanonicalFleetNumber,
} from "@/lib/spreadsheet"

export const MANUAL_STATEMENT_EVENT_TYPES = [
  "WHEEL_ALIGNMENT",
  "CHECKS_OK",
  "CHECKS_PENDING",
] as const
export type ManualStatementEventType =
  (typeof MANUAL_STATEMENT_EVENT_TYPES)[number]

export const MANUAL_EVENT_LABELS: Record<ManualStatementEventType, string> = {
  WHEEL_ALIGNMENT: "Wheel Alignment",
  CHECKS_OK: "Checks Performed - OK",
  CHECKS_PENDING: "Checks Pending",
}

export const MANUAL_EVENT_MATERIAL_NAMES: Record<
  ManualStatementEventType,
  string
> = {
  WHEEL_ALIGNMENT: "WHEEL ALIGNMENT",
  CHECKS_OK: "CHECKS PERFORMED - OK",
  CHECKS_PENDING: "CHECKS PENDING",
}

export const WHEEL_ALIGNMENT_MATERIAL_NAME =
  MANUAL_EVENT_MATERIAL_NAMES.WHEEL_ALIGNMENT
export const CHECKS_OK_MATERIAL_NAME = MANUAL_EVENT_MATERIAL_NAMES.CHECKS_OK
export const CHECKS_PENDING_MATERIAL_NAME =
  MANUAL_EVENT_MATERIAL_NAMES.CHECKS_PENDING
export const STATEMENT_BLANK_VALUE = "-"

export type StatementRowKind = "spare" | "manual" | "alignment" | "check"

// The fields the statement layout and exports actually use. Compatible
// with `SparesHistoryRow` without importing the server-only history module.
export type StatementSpareRow = {
  id: number
  kind?: StatementRowKind
  fitmentDate: string
  materialName: string
  identityNo: string
  partNumber: string
  subEquipment: string
  quantity: number | null
  amountUsd: number | null
  notes?: string | null
}

export function isManualStatementRow(row: Pick<StatementSpareRow, "kind">) {
  return row.kind === "manual" || row.kind === "alignment" || row.kind === "check"
}

export const isAlignmentStatementRow = isManualStatementRow

export function statementRowKey(row: Pick<StatementSpareRow, "id" | "kind">) {
  return `${row.kind ?? "spare"}-${row.id}`
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

export type StatementConsumableExclusion = {
  partNumber: string
  materialName: string
}

export type StatementPreviewFilters = {
  assetIds: string[]
  categories: string[]
  excludedAssets: string[]
  excludedConsumables: StatementConsumableExclusion[]
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

export function parseStatementAssetIds(
  value: string | string[] | undefined
): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : []

  return [
    ...new Set(
      raw
        .flatMap((item) => item.split(","))
        .map((item) => toCanonicalFleetNumber(item))
        .filter(Boolean)
    ),
  ]
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

export function formatStatementQty(value: number | null) {
  if (value === null) return STATEMENT_BLANK_VALUE
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function formatStatementLineQty(row: StatementSpareRow) {
  if (isManualStatementRow(row)) return STATEMENT_BLANK_VALUE
  return formatStatementQty(row.quantity)
}

export function formatStatementLineAmount(row: StatementSpareRow) {
  if (isManualStatementRow(row)) return STATEMENT_BLANK_VALUE
  return formatStatementUsd(row.amountUsd)
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
  assetIds = [],
  identityNos,
}: {
  assetType: StatementAssetScope
  assetIds?: string[]
  identityNos: string[]
}) {
  if (assetIds.length === 1) return assetIds[0]
  if (assetIds.length > 1 && assetIds.length <= 3) {
    return [...assetIds]
      .sort((left, right) =>
        left.localeCompare(right, undefined, { numeric: true })
      )
      .join(", ")
  }
  if (assetIds.length > 3) return `${assetIds.length} assets`
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

export function normalizePartAliasKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toUpperCase()
}

export function rowMatchesConsumableExclusion(
  row: Pick<StatementSpareRow, "partNumber" | "materialName">,
  exclusions: StatementConsumableExclusion[]
) {
  const partNumber = normalizePartAliasKey(row.partNumber)
  const materialName = normalizePartAliasKey(row.materialName)

  return exclusions.some(
    (item) =>
      normalizePartAliasKey(item.partNumber) === partNumber ||
      normalizePartAliasKey(item.materialName) === materialName
  )
}

export function applyStatementPreviewFilters<T extends StatementSpareRow>(
  rows: T[],
  {
    assetIds,
    categories,
    excludedAssets,
    excludedConsumables,
  }: StatementPreviewFilters
) {
  const selectedAssets = new Set(assetIds)
  const selected = new Set(
    categories.map((category) => normalizeSubEquipment(category)).filter(Boolean)
  )
  const excluded = new Set(excludedAssets)

  return rows.filter((row) => {
    const assetKey = statementAssetKey(row.identityNo)
    if (excluded.has(assetKey)) return false
    if (selectedAssets.size > 0 && !selectedAssets.has(assetKey)) return false
    if (isManualStatementRow(row)) return true
    if (rowMatchesConsumableExclusion(row, excludedConsumables)) return false
    if (selected.size === 0) return true
    return selected.has(normalizeSubEquipment(row.subEquipment))
  })
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
        // Newest intervention first so physical parts and injected
        // manual events interleave by date in the statement and exports.
        const dateCmp = right.fitmentDate.localeCompare(left.fitmentDate)
        if (dateCmp !== 0) return dateCmp
        const leftKind = left.kind ?? "spare"
        const rightKind = right.kind ?? "spare"
        if (leftKind !== rightKind) return leftKind === "spare" ? -1 : 1
        return right.id - left.id
      })

      return {
        name,
        rows: groupRows,
        totalQuantity: groupRows.reduce(
          (sum, row) => sum + (row.quantity ?? 0),
          0
        ),
        totalAmount: groupRows.reduce(
          (sum, row) => sum + (Number(row.amountUsd) || 0),
          0
        ),
      }
    })
}

export function statementTotals(rows: StatementSpareRow[]) {
  return {
    quantity: rows.reduce((sum, row) => sum + (row.quantity ?? 0), 0),
    amount: rows.reduce((sum, row) => sum + (Number(row.amountUsd) || 0), 0),
  }
}

export function sparesStatementHref({
  period = "mtd",
  assetType = "All",
  assetIds = [],
  fleetNo = "",
}: {
  period?: string
  assetType?: StatementAssetScope
  assetIds?: string[]
  fleetNo?: string
} = {}) {
  const params = new URLSearchParams()
  params.set("statement", "1")
  params.set("period", period)
  params.set("assetType", assetType)
  const ids = parseStatementAssetIds([...assetIds, fleetNo])
  for (const id of ids) params.append("fleetNo", id)
  return `/spares-history?${params.toString()}`
}
