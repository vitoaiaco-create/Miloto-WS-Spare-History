import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { SparesHistoryRow } from "@/lib/spares-history"

// Converts the `YYYY-MM-DD` string returned for `date()` columns into the
// `DD-MM-YYYY` display format used throughout this table.
function formatDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-")
  return `${day}-${month}-${year}`
}

// Costs come from the outward report's "Price ($)" and "Amount ($)" columns,
// which the report leaves blank on some lines.
function formatUsd(value: number | null) {
  return value === null ? "—" : `$${value.toFixed(2)}`
}

function formatRunningKm(runningKm: number | null) {
  return runningKm === null ? "—" : runningKm.toLocaleString()
}

export function SparesTable({
  spares,
  isFiltered,
}: {
  spares: SparesHistoryRow[]
  isFiltered: boolean
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Outward Date</TableHead>
          <TableHead>Material Name</TableHead>
          <TableHead>Identity No</TableHead>
          <TableHead>Part Number</TableHead>
          <TableHead>Sub Equipment</TableHead>
          <TableHead>Quantity</TableHead>
          <TableHead>Price ($)</TableHead>
          <TableHead>Amount ($)</TableHead>
          <TableHead>Running KM</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {spares.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={9}
              className="text-center text-muted-foreground"
            >
              {isFiltered
                ? "No spares history matches the selected filters."
                : "Set a filter above to view spares history."}
            </TableCell>
          </TableRow>
        ) : (
          spares.map((spare) => (
            <TableRow key={spare.id}>
              <TableCell>{formatDate(spare.fitmentDate)}</TableCell>
              <TableCell>{spare.materialName}</TableCell>
              <TableCell>{spare.identityNo}</TableCell>
              <TableCell>{spare.partNumber}</TableCell>
              <TableCell>{spare.subEquipment}</TableCell>
              <TableCell>{spare.quantity}</TableCell>
              <TableCell>{formatUsd(spare.priceUsd)}</TableCell>
              <TableCell>{formatUsd(spare.amountUsd)}</TableCell>
              <TableCell>{formatRunningKm(spare.runningKm)}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
