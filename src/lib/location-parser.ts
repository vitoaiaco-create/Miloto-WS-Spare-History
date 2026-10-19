export type ParsedFitmentLocation = {
  fitmentAxle: number | null
  fitmentSide: string | null
}

const AXLE_PATTERN =
  /(\d)(?:st|nd|rd|th)?\s*axle|axle\s*(\d)|\b(first|second|third|fourth|fifth|middle)\b\s*axle/i

const AXLE_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  middle: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
}

const BOTH_SIDES_PATTERN =
  /\bLH\s*&\s*RH\b|\bboth\b|\bleft\s*(?:and|&)\s*right\b/i
const LEFT_SIDE_PATTERN = /\bLH\b|\bleft\b/i
const RIGHT_SIDE_PATTERN = /\bRH\b|\bright\b/i

// Pulls a structured axle number and side out of the ERP "Location" cell
// so Spares History can filter on those without losing the raw string.
export function parseFitmentLocation(
  rawLocation: string | null | undefined
): ParsedFitmentLocation {
  const text = rawLocation?.trim() ?? ""
  if (!text) {
    return { fitmentAxle: null, fitmentSide: null }
  }

  const axleMatch = text.match(AXLE_PATTERN)
  let fitmentAxle: number | null = null
  if (axleMatch) {
    const digitToken = axleMatch[1] ?? axleMatch[2]
    const wordToken = axleMatch[3]
    if (digitToken) {
      const parsed = Number.parseInt(digitToken, 10)
      fitmentAxle = Number.isInteger(parsed) ? parsed : null
    } else if (wordToken) {
      fitmentAxle = AXLE_WORDS[wordToken.toLowerCase()] ?? null
    }
  }

  let fitmentSide: string | null = null
  if (BOTH_SIDES_PATTERN.test(text)) {
    fitmentSide = "Both"
  } else if (LEFT_SIDE_PATTERN.test(text)) {
    fitmentSide = "Left"
  } else if (RIGHT_SIDE_PATTERN.test(text)) {
    fitmentSide = "Right"
  }

  return { fitmentAxle, fitmentSide }
}
