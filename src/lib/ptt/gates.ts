import type { PttGateName, PttGateOverride } from "./constants"

// Deterministic upload / integrity gates for a post-work VERIFICATION scan.
// All pure: the route supplies hashes, OCR output and prior scans.

// ---------------------------------------------------------------------------
// 1. Duplicate / recycled image gate
// ---------------------------------------------------------------------------

export type PriorScanHashes = {
  scanId: number
  fleetId: string
  scannedAt: Date
  imageHashes: readonly string[]
}

export type RecycledImage = {
  /** Index of the offending file in the upload. */
  index: number
  hash: string
  /** Previous scan the same image belongs to; null = repeated within this upload. */
  previous: { scanId: number; fleetId: string; scannedAt: Date } | null
}

/**
 * Finds every uploaded image whose SHA-256 already exists in a prior scan
 * (same truck or a different one) or appears twice in the same upload.
 */
export function findRecycledImages(
  uploadHashes: readonly string[],
  priorScans: readonly PriorScanHashes[]
): RecycledImage[] {
  const previousByHash = new Map<string, PriorScanHashes>()
  for (const scan of priorScans) {
    for (const hash of scan.imageHashes) {
      const known = previousByHash.get(hash)
      // Report the oldest scan the image first appeared in.
      if (!known || scan.scannedAt.getTime() < known.scannedAt.getTime()) {
        previousByHash.set(hash, scan)
      }
    }
  }

  const seen = new Set<string>()
  const recycled: RecycledImage[] = []
  uploadHashes.forEach((hash, index) => {
    const previous = previousByHash.get(hash)
    if (previous) {
      recycled.push({
        index,
        hash,
        previous: {
          scanId: previous.scanId,
          fleetId: previous.fleetId,
          scannedAt: previous.scannedAt,
        },
      })
    } else if (seen.has(hash)) {
      recycled.push({ index, hash, previous: null })
    }
    seen.add(hash)
  })
  return recycled
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** User-facing rejection naming the previous truck and scan date. */
export function formatRecycledImageError(
  recycled: readonly RecycledImage[],
  fileNames: readonly string[]
): string {
  const parts = recycled.map((item) => {
    const name = fileNames[item.index] ?? `Image ${item.index + 1}`
    return item.previous
      ? `"${name}" was already used in the ${item.previous.fleetId} scan of ${formatDate(item.previous.scannedAt)}`
      : `"${name}" is a duplicate of another image in this upload`
  })
  return `Recycled screenshot(s) rejected: ${parts.join("; ")}. Upload fresh post-work photos taken after the repair.`
}

// ---------------------------------------------------------------------------
// 2. Header-count completeness gate
// ---------------------------------------------------------------------------

export type CompletenessCheck = {
  isComplete: boolean
  headerItemCount: number | null
  extractedItemCount: number
  /** Faults still missing (0 when complete or the header was unreadable). */
  missingCount: number
  message: string | null
}

/**
 * `DTC List (N Items)` vs the number of distinct rows extracted. Complete when
 * the header could not be read (nothing to compare) or every item was read.
 */
export function checkScanCompleteness(
  headerItemCount: number | null,
  extractedItemCount: number
): CompletenessCheck {
  const isComplete =
    headerItemCount === null || extractedItemCount >= headerItemCount
  return {
    isComplete,
    headerItemCount,
    extractedItemCount,
    missingCount:
      headerItemCount === null
        ? 0
        : Math.max(0, headerItemCount - extractedItemCount),
    message: isComplete
      ? null
      : `INCOMPLETE_SCAN: Captured ${extractedItemCount} of ${headerItemCount} faults — upload the missing scroll page(s)`,
  }
}

// ---------------------------------------------------------------------------
// 2b. Selected-footer cross-check (soft warning, never blocks)
// ---------------------------------------------------------------------------

export type SelectedFooterCheck = {
  /** `null` when the footer could not be read (nothing to compare). */
  matched: boolean | null
  message: string | null
}

const footerKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "")

/**
 * The bold fault title in the PTT bottom-left panel is the selected row, so it
 * must be one of the transcribed rows. When no extracted description matches
 * it, the first screenshot may not start at the true top of the list (or a row
 * was misread). Loose matching (containment / shared prefix) tolerates the
 * truncated descriptions PTT prints in the list.
 */
export function checkSelectedFooterCoverage(
  selectedFooterText: string | null,
  rowDescriptions: readonly string[]
): SelectedFooterCheck {
  const footer = footerKey(selectedFooterText ?? "")
  if (footer === "") return { matched: null, message: null }

  const matched = rowDescriptions.some((description) => {
    const row = footerKey(description)
    if (row === "") return false
    if (row.includes(footer) || footer.includes(row)) return true
    const prefix = Math.min(row.length, footer.length, 14)
    return prefix >= 8 && row.slice(0, prefix) === footer.slice(0, prefix)
  })
  return {
    matched,
    message: matched
      ? null
      : `the selected fault shown in the PTT footer ("${(selectedFooterText ?? "").trim()}") matches none of the transcribed rows - the first screenshot may not start at the top of the DTC List, so re-scan from the very first row.`,
  }
}

// ---------------------------------------------------------------------------
// 3. Truck identity check
// ---------------------------------------------------------------------------

export type TruckIdentityCheck = {
  conflict: boolean
  message: string | null
}

// "MTL 41", "mtl-041", "MTL41" -> { prefix: "MTL", number: 41 }
const FLEET_TOKEN = /\b([A-Z]{2,4})[\s\-_]*0*(\d{1,4})\b/g

function fleetTokens(text: string): Array<{ prefix: string; number: number }> {
  return [...text.toUpperCase().matchAll(FLEET_TOKEN)].map((match) => ({
    prefix: match[1],
    number: Number(match[2]),
  }))
}

/**
 * Compares the work-order text read from the PTT status bar with the selected
 * fleet id. It only flags a *clear* conflict: a fleet-number-looking token
 * with the same prefix but a different number, and no token matching the
 * selected truck. Numeric / free-form work orders prove nothing either way.
 */
export function checkTruckIdentity(
  fleetId: string,
  workOrderOcr: string | null
): TruckIdentityCheck {
  if (!workOrderOcr || workOrderOcr.trim() === "") {
    return { conflict: false, message: null }
  }
  const selected = fleetTokens(fleetId)[0]
  if (!selected) return { conflict: false, message: null }

  const samePrefix = fleetTokens(workOrderOcr).filter(
    (token) => token.prefix === selected.prefix
  )
  if (
    samePrefix.length === 0 ||
    samePrefix.some((token) => token.number === selected.number)
  ) {
    return { conflict: false, message: null }
  }

  const found = samePrefix
    .map((token) => `${token.prefix}${token.number}`)
    .join(", ")
  return {
    conflict: true,
    message: `TRUCK_MISMATCH: the PTT work order reads "${workOrderOcr.trim()}" (${found}) but this case is for ${fleetId.trim().toUpperCase()}. Check that the photos belong to the right truck.`,
  }
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

/**
 * Builds the audit entry for a gate override. A blank reason is refused: an
 * override without a logged reason is not an override.
 */
export function buildGateOverride(
  gate: PttGateName,
  reason: string,
  by: string,
  at: Date
): PttGateOverride | null {
  const trimmed = reason.trim()
  if (trimmed.length === 0) return null
  return { gate, reason: trimmed, by, at: at.toISOString() }
}
