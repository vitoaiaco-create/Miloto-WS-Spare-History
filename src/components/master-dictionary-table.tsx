"use client"

import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type MasterDictionaryRow = {
  id: number
  partNumber: string
  materialName: string | null
  tier1: string | null
  tier2: string | null
  tier3: string | null
  assetClass: string | null
}

// Rows per page for the client-side pagination below — the dictionary is a
// few thousand rows at most, so slicing an already-fetched array locally is
// simpler than wiring up server-side pagination for this read-only view.
const PAGE_SIZE = 25

function cellOrDash(value: string | null) {
  return value && value !== "" ? value : "—"
}

// Client Component: renders every row of `masterTaxonomyDictionaryTable`
// handed down by the Server Component in src/components/master-dictionary.tsx,
// paginated locally so the Master Dictionary tab stays scannable instead of
// rendering every record in one unbroken list.
export function MasterDictionaryTable({ rows }: { rows: MasterDictionaryRow[] }) {
  const [page, setPage] = useState(0)

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages - 1)
  const pageRows = useMemo(
    () => rows.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [rows, currentPage]
  )
  const rangeStart = rows.length === 0 ? 0 : currentPage * PAGE_SIZE + 1
  const rangeEnd = Math.min(rows.length, currentPage * PAGE_SIZE + PAGE_SIZE)

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle>Master Taxonomy Dictionary</CardTitle>
        <CardDescription>
          Every Part Number on file in the master taxonomy dictionary —{" "}
          {rows.length.toLocaleString()} record{rows.length === 1 ? "" : "s"} total.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Part Number</TableHead>
              <TableHead>Material Name</TableHead>
              <TableHead>Tier 1</TableHead>
              <TableHead>Tier 2</TableHead>
              <TableHead>Tier 3</TableHead>
              <TableHead>Asset Class</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No dictionary records on file.
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.partNumber}</TableCell>
                  <TableCell>{cellOrDash(row.materialName)}</TableCell>
                  <TableCell>{cellOrDash(row.tier1)}</TableCell>
                  <TableCell>{cellOrDash(row.tier2)}</TableCell>
                  <TableCell>{cellOrDash(row.tier3)}</TableCell>
                  <TableCell>
                    {row.assetClass ? (
                      <Badge variant="outline">{row.assetClass}</Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "No records"
              : `Showing ${rangeStart}–${rangeEnd} of ${rows.length.toLocaleString()}`}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Page {currentPage + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages - 1}
              onClick={() =>
                setPage((current) => Math.min(totalPages - 1, current + 1))
              }
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
