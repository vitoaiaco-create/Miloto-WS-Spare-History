import type {
  PttExceptionReasonCategory,
  PttKnownGeneration,
} from "./constants"

// Confirmed fleet-wide approved exceptions: faults that are physically
// expected on EVERY truck of a generation (verified on the vehicles), so they
// never block a Before/After closure. Pure data: consumed by the idempotent
// seed script (scripts/seed-ptt-exceptions.ts) and by the unit tests.

export type SeedException = {
  generation: PttKnownGeneration
  canonicalKey: string
  reasonCategory: PttExceptionReasonCategory
  physicalProofNote: string
}

export const SEED_APPROVED_BY = "system-seed"

export const FLEET_WIDE_EXCEPTION_SEEDS: readonly SeedException[] = [
  {
    generation: "FH_V4",
    canonicalKey: "CCIOM|C103715",
    reasonCategory: "UNFITTED_AUTO_GREASE",
    physicalProofNote:
      "Unfitted automatic chassis lubrication pump: no pump on the chassis, so the CCIOM circuit fault is expected.",
  },
  ...(
    [
      "MID144|PSID23|FMI4",
      "MID144|PSID24|FMI4",
      "MID144|PPID312|FMI7",
    ] as const
  ).map(
    (canonicalKey): SeedException => ({
      generation: "FH_V3",
      canonicalKey,
      reasonCategory: "MANUAL_AIR_DRYER",
      physicalProofNote:
        "Manual air dryer conversion: the electronic air dryer / compressor governor circuits are intentionally not connected.",
    })
  ),
  ...(
    [
      "MID144|PSID39|FMI4",
      "MID144|PSID39|FMI1",
      "MID144|PSID39|FMI12",
    ] as const
  ).map(
    (canonicalKey): SeedException => ({
      generation: "FH_V3",
      canonicalKey,
      reasonCategory: "MANUAL_LOAD_VALVE",
      physicalProofNote:
        "Manual rear load-sensing valve conversion: the electronic rear load-sensing valve circuit is intentionally not connected.",
    })
  ),
  ...(
    ["MID140|PSID214|FMI12", "MID144|PSID214|FMI9"] as const
  ).map(
    (canonicalKey): SeedException => ({
      generation: "FH_V3",
      canonicalKey,
      reasonCategory: "UNUSED_AUX_MODULE",
      physicalProofNote:
        "Unused Body Builder Module (MID 249): no body builder module is installed, so the missing-module code is expected.",
    })
  ),
  {
    generation: "FH_V3",
    canonicalKey: "MID140|PSID236|FMI12",
    reasonCategory: "UNUSED_AUX_MODULE",
    physicalProofNote:
      "Unused FMS Gateway (MID 179): no FMS gateway is installed, so the missing-module code is expected.",
  },
  ...(
    ["MID206|PSID10|FMI2", "MID206|PSID10|FMI7"] as const
  ).map(
    (canonicalKey): SeedException => ({
      generation: "FH_V3",
      canonicalKey,
      reasonCategory: "UNUSED_AUX_MODULE",
      physicalProofNote:
        "Radio CD player (MID 206): aftermarket / disconnected head unit, so its datalink codes are expected.",
    })
  ),
]
