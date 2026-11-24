"use client"

import { ScanLine } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Placeholder for the PTT screenshot uploader. The props are the final
// contract: the real uploader replaces this component's body and calls
// `onScanComplete` once a scan has been analysed and saved.
export function NewPttScanPanel({
  initialFleetId,
  onScanComplete,
}: {
  initialFleetId?: string | null
  onScanComplete: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <ScanLine className="mb-2 size-6 text-foreground" strokeWidth={1.75} />
        <CardTitle className="text-lg">New PTT Scan</CardTitle>
        <CardDescription>
          The PTT screenshot uploader and AI analysis will appear here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Selected truck:</span>
          {initialFleetId ? (
            <Badge variant="outline" className="font-mono">
              {initialFleetId}
            </Badge>
          ) : (
            <span className="text-muted-foreground">None selected</span>
          )}
        </div>
        <Button variant="outline" onClick={onScanComplete}>
          Back to Fleet Coverage
        </Button>
      </CardContent>
    </Card>
  )
}
