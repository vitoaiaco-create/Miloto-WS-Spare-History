import {
  PTT_IMAGE_MAX_BYTES,
  PTT_IMAGE_TYPES,
} from "@/lib/ptt-diagnostics"

// Pure helpers for PTT screenshot uploads (file name / blob path hygiene).
// Used by the diagnostics Route Handlers.

export function extensionOf(name: string) {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(dot).toLowerCase()
}

// Strips any path, keeps `[A-Za-z0-9._-]`, and caps the length (keeping the
// extension) so the name is safe in a blob pathname and a header.
export function sanitizeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? ""
  const ext = extensionOf(base)
  const stem = (ext ? base.slice(0, -ext.length) : base)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100)
  return `${stem || "screenshot"}${ext}`
}

// Fleet id as a single safe blob path segment. Expects an already
// normalized (trimmed, uppercase) id.
export function sanitizeFleetIdForPath(fleetId: string) {
  return fleetId.replace(/[^A-Z0-9_-]+/g, "_").slice(0, 50) || "UNKNOWN"
}

// Prefix every screenshot for a fleet is stored under.
export function pttBlobPrefix(normalizedFleetId: string) {
  return `ptt-diagnostics/${sanitizeFleetIdForPath(normalizedFleetId)}/`
}

// Returns a user-facing problem, or null when the image is acceptable.
export function validateImageFile(file: File): string | null {
  const ext = extensionOf(file.name)
  const allowed = (PTT_IMAGE_TYPES as Record<string, readonly string[]>)[ext]
  if (!allowed) {
    return `"${file.name}" is not allowed. Use JPG, PNG or WEBP images.`
  }
  if (!allowed.includes(file.type)) {
    return `"${file.name}" has an unsupported file type (${file.type || "unknown"}).`
  }
  if (file.size === 0) return `"${file.name}" is empty.`
  if (file.size > PTT_IMAGE_MAX_BYTES) {
    return `"${file.name}" is larger than 4.5 MB.`
  }
  return null
}
