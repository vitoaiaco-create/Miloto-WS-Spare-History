import type { PttDirective, PttFaultSeverity } from "../ptt-diagnostics"
import type { PttCaseStatus } from "./constants"
import { FLEET_WIDE_EXCEPTION_SEEDS } from "./exception-seed-data"
import { reconcileDiagnosticScans, type ReconcileFault } from "./reconcile"
import type {
  PttReportBaselineFault,
  PttReportCase,
  PttReportExceptionRule,
  PttReportScanFault,
} from "./report-data"
import type { PttVerificationAudit } from "./verification-audit-schema"

// Test fixtures for the report-data layer: the real MTL41 (FH V3) Before /
// After case (same keys as reconcile.test.ts) plus small builders for the other
// scenarios. Not shipped to users; only imported from tests.

export const BASELINE_KEYS = [
  "MID128|PID153|FMI5",
  "MID128|PID175|FMI5",
  "MID128|PID84|FMI9",
  "MID128|PID94|FMI5",
  "MID128|SID18|FMI5",
  "MID140|PSID210|FMI12",
  "MID140|PSID214|FMI12",
  "MID140|PSID236|FMI12",
  "MID206|PSID10|FMI2",
  "MID206|PSID10|FMI7",
  "MID144|PID84|FMI2",
  "MID144|PPID3|FMI4",
  "MID144|PSID214|FMI9",
  "MID144|PSID23|FMI4",
  "MID144|PSID39|FMI4",
]

export const VERIFICATION_KEYS = [
  "MID128|PID26|FMI3",
  "MID128|PID84|FMI9",
  "MID140|PSID210|FMI12",
  "MID140|PSID214|FMI12",
  "MID140|PSID236|FMI12",
  "MID206|PSID10|FMI2",
  "MID206|PSID10|FMI7",
  "MID144|PID84|FMI2",
  "MID144|PPID312|FMI7",
  "MID144|PPID3|FMI4",
  "MID144|PSID214|FMI9",
  "MID144|PSID23|FMI4",
  "MID144|PSID24|FMI4",
  "MID144|PSID39|FMI4",
]

export const SEVERITY: Record<string, PttFaultSeverity> = {
  "MID128|PID153|FMI5": "CRITICAL",
  "MID128|PID175|FMI5": "CRITICAL",
  "MID128|PID94|FMI5": "CRITICAL",
  "MID128|SID18|FMI5": "CALIBRATION_ONLY",
  "MID128|PID84|FMI9": "CRITICAL",
  "MID144|PID84|FMI2": "CRITICAL",
  "MID144|PPID3|FMI4": "MONITOR",
  "MID140|PSID210|FMI12": "MONITOR",
  "MID128|PID26|FMI3": "MONITOR",
}

export const DESCRIPTIONS: Record<string, string> = {
  "MID128|PID94|FMI5": "Fuel Delivery Pressure",
  "MID128|PID175|FMI5": "Engine Oil Temperature",
  "MID128|PID153|FMI5": "Crankcase Pressure",
  "MID128|SID18|FMI5": "Water-in-Fuel Drain Valve",
  "MID128|PID84|FMI9": "Road Speed (Engine ECU)",
  "MID144|PID84|FMI2": "Road Speed (Vehicle ECU)",
  "MID144|PPID3|FMI4": "Starter Output",
  "MID140|PSID210|FMI12": "Lighting Control Module Offline",
  "MID128|PID26|FMI3": "Exhaust Brake Pressure",
}

export const FLEET_EXCEPTIONS: PttReportExceptionRule[] =
  FLEET_WIDE_EXCEPTION_SEEDS.map((seed) => ({
    scope: "FLEET_GENERATION" as const,
    generation: seed.generation,
    fleetId: null,
    canonicalKey: seed.canonicalKey,
    isActive: true,
    reasonCategory: seed.reasonCategory,
  }))

const V3_KEY = /^MID(\d+)\|(PID|PPID|SID|PSID)(\d+)\|FMI(\d+)$/

/** `MID128|PID94|FMI5` -> the unit / code strings PTT prints. */
export function rawParts(key: string): { controlUnit: string; faultCode: string } {
  const match = V3_KEY.exec(key)
  if (!match) throw new Error(`Fixture key is not FH V3: ${key}`)
  return {
    controlUnit: `MID ${match[1]}`,
    faultCode: `${match[2]} ${match[3]} FMI ${match[4]}`,
  }
}

export const DIRECTIVE: PttDirective = {
  evidence_analysis: "Evidence.",
  parts_cannon_warning: "PARTS-WARNING-TEXT: do not replace the injectors blindly.",
  true_diagnosis: "TRUE-DIAGNOSIS-TEXT: shared engine harness connector.",
  physical_inspections: ["Inspect the engine harness connector", "Check fuel filter housing"],
  ptt_navigation_paths: ["PTT > Engine > Live data", "PTT > Gearbox > Calibrations"],
  verification_criteria: ["No active MID128 codes", "Fuel pressure within range"],
}

export function baselineFault(
  key: string,
  overrides: Partial<PttReportBaselineFault> = {}
): PttReportBaselineFault {
  const { controlUnit, faultCode } = rawParts(key)
  return {
    controlUnit,
    faultCode,
    componentDescription: DESCRIPTIONS[key] ?? "Generic circuit fault",
    faultState: "ACTIVE",
    occurrenceCount: 3,
    severity: SEVERITY[key] ?? "MONITOR",
    rootCauseSummary: `ROOT-CAUSE ${key}: inspect the circuit.`,
    calibrationRequired: false,
    resolvedOnRescan: false,
    ...overrides,
  }
}

export function scanFault(
  key: string,
  overrides: Partial<PttReportScanFault> = {}
): PttReportScanFault {
  const { controlUnit, faultCode } = rawParts(key)
  return {
    canonicalKey: key,
    ecuLabel: controlUnit,
    dtcRaw: faultCode,
    description: DESCRIPTIONS[key] ?? "Generic circuit fault",
    pttStatus: "ACTIVE",
    severity: SEVERITY[key] ?? "MONITOR",
    reconciliationBucket: null,
    isBounceBack: false,
    isApprovedException: false,
    ...overrides,
  }
}

const reconcileFault = (key: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE"): ReconcileFault => ({
  canonicalKey: key,
  pttStatus: status,
  severity: SEVERITY[key] ?? "MONITOR",
})

export const VERIFICATION_AUDIT: PttVerificationAudit = {
  verdictHeadline: "Repair incomplete: 4 cleared, 2 blocking fault(s) still open, 1 new regression(s).",
  collateralDamageAnalysis:
    "COLLATERAL-TEXT: PID26 appeared after the fuel pressure repair; recheck the disturbed connector.",
  untouchedBlockersSummary: null,
  repeatFaultEscalation: null,
  nextFloorActions: ["Recheck the engine harness connector", "Road test and re-scan"],
}

/** Real MTL41 (FH V3) before / after case. */
export function mtl41Case(
  overrides: Partial<PttReportCase> = {}
): PttReportCase {
  const reconciliation = reconcileDiagnosticScans({
    fleetId: "MTL41",
    generation: "FH_V3",
    baselineFaults: BASELINE_KEYS.map((key) => reconcileFault(key)),
    verificationFaults: VERIFICATION_KEYS.map((key) => reconcileFault(key)),
    exceptions: FLEET_EXCEPTIONS,
  })
  const onVerification = new Set(VERIFICATION_KEYS)

  return {
    id: 1,
    fleetId: "MTL41",
    truckGeneration: "FH_V3",
    status: "IN_PROGRESS",
    caseStatus: reconciliation.caseStatus,
    scannedAt: new Date(2026, 10, 20, 8, 0),
    verifiedAt: null,
    verificationSummary: null,
    aiDirective: DIRECTIVE,
    faults: BASELINE_KEYS.map((key) => baselineFault(key)),
    verificationScans: [
      {
        id: 2,
        scannedAt: new Date(2026, 10, 24, 9, 30),
        caseStatus: reconciliation.caseStatus,
        verificationAudit: VERIFICATION_AUDIT,
        scanFaults: reconciliation.faults.map((fault) =>
          scanFault(fault.canonicalKey, {
            severity: fault.severity,
            pttStatus: onVerification.has(fault.canonicalKey) ? "ACTIVE" : "INACTIVE",
            reconciliationBucket: fault.bucket,
            isBounceBack: fault.isBounceBack,
            isApprovedException: fault.isApprovedException,
          })
        ),
      },
    ],
    ...overrides,
  }
}

/** A truck with only a baseline scan (no verification yet). */
export function baselineOnlyCase(
  keys: readonly string[],
  overrides: Partial<PttReportCase> = {}
): PttReportCase {
  return {
    id: 10,
    fleetId: "MTL07",
    truckGeneration: "FH_V3",
    status: "DIRECTIVE_ISSUED",
    caseStatus: "OPEN",
    scannedAt: new Date(2026, 10, 25, 7, 0),
    verifiedAt: null,
    verificationSummary: null,
    aiDirective: DIRECTIVE,
    faults: keys.map((key) => baselineFault(key)),
    verificationScans: [],
    ...overrides,
  }
}

/**
 * A truck whose re-scan cleared every baseline fault (`VERIFIED_CLOSED`, zero
 * actionable faults remaining).
 */
export function closedCase(
  keys: readonly string[],
  overrides: Partial<PttReportCase> = {}
): PttReportCase {
  const caseStatus: PttCaseStatus = "VERIFIED_CLOSED"
  return {
    id: 20,
    fleetId: "MTL02",
    truckGeneration: "FH_V3",
    status: "VERIFIED_CLOSED",
    caseStatus,
    scannedAt: new Date(2026, 10, 18, 7, 0),
    verifiedAt: new Date(2026, 10, 22, 15, 0),
    verificationSummary: null,
    aiDirective: DIRECTIVE,
    faults: keys.map((key) => baselineFault(key)),
    verificationScans: [
      {
        id: 21,
        scannedAt: new Date(2026, 10, 22, 15, 0),
        caseStatus,
        verificationAudit: {
          ...VERIFICATION_AUDIT,
          verdictHeadline: "Repair verified: every actionable fault cleared.",
          collateralDamageAnalysis: null,
          nextFloorActions: ["No blocking faults remain: close the job card and release the truck."],
        },
        scanFaults: keys.map((key) =>
          scanFault(key, {
            pttStatus: "INACTIVE",
            reconciliationBucket: "CLEARED",
          })
        ),
      },
    ],
    ...overrides,
  }
}
