import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { OilHealthRow } from "@/lib/oil-analytics"

function formatKm(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-US")
}

function formatLiters(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })
}

function formatBurnRate(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
}

export function OilHealthTable({ rows }: { rows: OilHealthRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Asset ID</TableHead>
          <TableHead className="text-right">KM Since Last Service</TableHead>
          <TableHead className="text-right">Total Top-up (L)</TableHead>
          <TableHead className="text-right">Burn Rate (L/1000km)</TableHead>
          <TableHead className="text-right">KM Since Last Sample</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={5}
              className="text-center text-muted-foreground"
            >
              No active Miloto assets found.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.assetId}>
              <TableCell>{row.assetName}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatKm(row.kmSinceLastService)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatLiters(row.totalTopUpLiters)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatBurnRate(row.burnRate)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatKm(row.kmSinceLastSample)}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
