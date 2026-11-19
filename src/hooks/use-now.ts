"use client"

import { useEffect, useState } from "react"

// Returns the current time in ms and re-renders every `intervalMs`, so
// elapsed-time badges and time-window filters stay accurate while the page
// is left open.
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}
