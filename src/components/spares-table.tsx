"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function SparesTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Fleet Number</TableHead>
          <TableHead>Position</TableHead>
          <TableHead>Part Name</TableHead>
          <TableHead>Cost Kwacha</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>2026-09-01</TableCell>
          <TableCell>MTL-01</TableCell>
          <TableCell>Front Left</TableCell>
          <TableCell>Brake Pad Set</TableCell>
          <TableCell>ZMW 450.00</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
