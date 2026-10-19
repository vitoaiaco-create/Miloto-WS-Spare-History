"use client"

import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AirSystemComplianceRow } from "@/lib/air-system"
import { formatStatementDate, formatStatementQty } from "@/lib/spares-statement"
import { cn } from "@/lib/utils"

const TABLE_CONTAINER_CLASS =
  "relative w-full overflow-x-auto print:max-h-none print:overflow-visible"

function StatusBadge({ status }: { status: AirSystemComplianceRow["status"] }) {
  if (status === "OK") {
    return (
      <Badge className="border-transparent bg-green-500/10 text-green-700 dark:text-green-400">
        OK
      </Badge>
    )
  }

  if (status === "Failed") {
    return <Badge variant="destructive">Failed</Badge>
  }

  return <Badge variant="secondary">Pending</Badge>
}

function ResponseSparesCell({ row }: { row: AirSystemComplianceRow }) {
  if (row.status !== "Failed") {
    return <span className="text-muted-foreground">—</span>
  }

  if (row.responseSpares.length === 0) {
    return <span className="text-muted-foreground">No parts issued</span>
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {row.responseSpares.map((spare, index) => (
        <li key={`${row.assetId}-${spare.materialName}-${index}`}>
          {spare.materialName}{" "}
          <span className="text-muted-foreground">
            × {formatStatementQty(spare.quantity)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function AirSystemTable({
  rows,
}: {
  rows: AirSystemComplianceRow[]
}) {
  return (
    <Table
      className="print:text-[11px] print:text-black"
      containerClassName={TABLE_CONTAINER_CLASS}
    >
      <TableHeader className="sticky top-0 z-10 bg-background shadow-sm print:static print:shadow-none [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background print:[&_th]:static print:[&_th]:bg-white print:[&_th]:text-black">
        <TableRow className="hover:bg-transparent print:border-black">
          <TableHead className="print:border print:border-black print:px-1.5">
            Asset ID
          </TableHead>
          <TableHead className="print:border print:border-black print:px-1.5">
            Type
          </TableHead>
          <TableHead className="print:border print:border-black print:px-1.5 print:w-[9rem]">
            Status
          </TableHead>
          <TableHead className="print:border print:border-black print:px-1.5">
            Date Tested
          </TableHead>
          <TableHead className="print:hidden">Response Spares</TableHead>
          <TableHead className="hidden w-[42%] min-w-[16rem] whitespace-normal print:table-cell print:border print:border-black print:px-1.5">
            Mechanic Notes &amp; Findings
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={6}
              className="py-8 text-center text-muted-foreground print:hidden"
            >
              No active horses or trailers on file.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow
              key={row.assetId}
              className={cn(
                "print:h-12 print:border-black print:bg-white print:hover:bg-white",
                row.status === "Failed" && "bg-destructive/5 print:bg-white"
              )}
            >
              <TableCell className="font-medium print:border print:border-black print:px-1.5 print:text-black">
                {row.assetName}
              </TableCell>
              <TableCell className="print:border print:border-black print:px-1.5 print:text-black">
                {row.assetType}
              </TableCell>
              <TableCell className="print:border print:border-black print:px-1.5 print:align-middle print:text-black">
                <span className="print:hidden">
                  <StatusBadge status={row.status} />
                </span>
                <span className="hidden print:inline-flex print:gap-4 print:text-[11px] print:text-black">
                  <span>☐ Pass</span>
                  <span>☐ Fail</span>
                </span>
              </TableCell>
              <TableCell className="print:border print:border-black print:px-1.5 print:text-black">
                <span className="print:hidden">
                  {row.dateTested ? formatStatementDate(row.dateTested) : "—"}
                </span>
                <span className="hidden print:inline">
                  {row.dateTested ? formatStatementDate(row.dateTested) : ""}
                </span>
              </TableCell>
              <TableCell className="max-w-[22rem] whitespace-normal print:hidden">
                <ResponseSparesCell row={row} />
              </TableCell>
              <TableCell className="hidden print:table-cell print:border print:border-black print:align-top" />
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
