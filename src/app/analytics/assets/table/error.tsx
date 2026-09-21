"use client"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function AnalyticsAssetsTableError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>This page couldn't load</CardTitle>
        <CardDescription>
          The Master Costings Table failed to render.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-sm text-destructive">{error.message}</p>
      </CardContent>
      <CardFooter>
        <Button onClick={() => reset()}>Try again</Button>
      </CardFooter>
    </Card>
  )
}
