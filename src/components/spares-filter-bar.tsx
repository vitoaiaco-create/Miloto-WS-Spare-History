"use client"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function SparesFilterBar() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Input
        placeholder="Filter by Fleet No (e.g. MTL-01 or MT-05)..."
        className="sm:max-w-sm"
      />
      <Select>
        <SelectTrigger className="sm:w-56">
          <SelectValue placeholder="Taxonomy category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="engine">Engine</SelectItem>
          <SelectItem value="brakes">Brakes</SelectItem>
          <SelectItem value="electrical">Electrical</SelectItem>
          <SelectItem value="tyres">Tyres</SelectItem>
          <SelectItem value="body">Body</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
