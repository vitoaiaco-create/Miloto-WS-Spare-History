import type { AssetSubEquipmentCosting } from "@/actions/analytics"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { normalizeSubEquipment } from "@/lib/spreadsheet"

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const percentFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function AssetCostingsTable({
  costings,
}: {
  costings: AssetSubEquipmentCosting[]
}) {
  const totalUsd = costings.reduce((total, row) => total + row.totalUsd, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sub Equipment Costings</CardTitle>
        <CardDescription>
          Maintenance spend by normalized category for the selected asset and
          timeframe.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sub Equipment</TableHead>
              <TableHead className="text-right">Total Spend (USD)</TableHead>
              <TableHead className="text-right">% of Total Spend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {costings.map((row) => (
              <TableRow key={row.subEquipment}>
                <TableCell className="font-medium">
                  {normalizeSubEquipment(row.subEquipment)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {usdFormat.format(row.totalUsd)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {percentFormat.format(row.percentage / 100)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="bg-muted hover:bg-muted">
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                {usdFormat.format(totalUsd)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                {percentFormat.format(1)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  )
}
