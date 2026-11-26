import "server-only"

import OpenAI from "openai"

import { runJsonPass } from "./extraction"
import {
  normalizeVerificationAudit,
  pttVerificationAuditSchema,
  type PttVerificationAudit,
  type VerificationAuditInput,
} from "./verification-audit-schema"

// Pass 2, mode B: VERIFICATION_AUDIT (forensic). Runs on a post-work re-scan
// AFTER the deterministic 5-bucket reconciliation succeeded. The model never
// re-tiers or re-buckets anything: it explains the outcome (collateral damage,
// untouched blockers, repeat faults) and gives the floor its next actions.

export const VERIFICATION_AUDIT_TIMEOUT_MS = 14_000
const VERIFICATION_AUDIT_MAX_TOKENS = 1500

export const VERIFICATION_AUDIT_SYSTEM_PROMPT = `MODE: VERIFICATION_AUDIT (FORENSIC).
You are the Volvo Master Diagnostic & Enforcement Engine auditing a POST-WORK PTT RE-SCAN of a Volvo FH V3 / FH V4 (24V) truck for Zambezi Portland Cement / Miloto Transport (Ndola, Zambia).

YOUR INPUT
ONE JSON object produced by deterministic code. It is ground truth: never re-tier, re-bucket or second-guess it.
- caseStatus: the deterministic verdict (OPEN / PARTIAL_BLOCKED / VERIFIED_CLOSED / REJECTED_NO_PROGRESS ...).
- cleared: faults active before the repair and gone now.
- persistingOpen: faults active before AND after, not approved exceptions.
- newRegressions: faults that were NOT active before the repair but are active now (introduced by the work).
- persistingExceptions / newExceptions: approved exceptions. Read-only background: NEVER mention them anywhere in your answer.
- bounceBackItems: faults that came back within 30 days of being cleared, or were reopened before (isBounceBack === true or reopenCount >= 1).
Each fault has canonicalKey (FH V3: MID#|PID/PPID/SID/PSID#|FMI#; FH V4: ECU|DTC), ecuLabel, description, severity, isBounceBack, reopenCount.

OUTPUT FIELDS
- verdictHeadline: ONE concise sentence summarising the repair outcome (how many cleared, what still blocks, any regression).
- collateralDamageAnalysis: string, REQUIRED whenever newRegressions is not empty, otherwise null. Correlate EACH new regression with the cleared faults by ECU, harness branch or physical proximity, naming both keys. Example: MID128|PID26|FMI3 appearing on the exact MID 128 engine loom that was disturbed to clear PID 94 / PID 175 / PID 153 / SID 18 points at a connector left unseated, a pinched / chafed wire or a displaced clip on that loom. Name the loom branch / connector to inspect first.
- untouchedBlockersSummary: string, or null when no persistingOpen fault is CRITICAL or CALIBRATION_ONLY. Concisely summarise the blocking Critical / Calibration faults the workshop did NOT resolve (exact keys, ECU, what each means). Never mention approved exceptions.
- repeatFaultEscalation: string, REQUIRED whenever ANY fault has isBounceBack === true or reopenCount >= 1, otherwise null. Explicitly BAN quick DTC resets and connector wiggling as a "fix", and MANDATE root-cause testing: a pin drag test on the connector, load-testing the wires under current, or measuring mechanical wear against the Volvo limit.
- nextFloorActions: array of 1 to 4 short, concrete floor instructions that target ONLY newRegressions and the blocking persistingOpen faults. Each names the exact key / ECU and a measurable check or PTT test. Nothing generic.

ENGINEERING RULES
- These are 24V trucks: NEVER write a 12V or 10V threshold, and never apply a 5V sensor threshold to a 24V solenoid (SID 18, PPID 124). Use bar, degC, km/h, a 24V supply, or continuity / ground integrity.
- FMI 3 / FMI 4 / FMI 5 and FH V4 P255800 are ELECTRICAL circuit faults (never send mechanics hunting a fuel blockage for PID 94 FMI 3 or a coolant leak as the primary cause of P255800). FMI 6 (e.g. MID 216 PSID 8 / PSID 26) is an ACTIVE SHORT TO GROUND risking LCM output-driver damage: harness and socket first.
- MID 130 PID 160 is INTERNAL to the I-Shift top cover (no external harness). MID 130 PID 37 FMI 1: build the dash gauges to 9.5-12 bar first. APM C101068 is the air-dryer desiccant counter. CCIOM C10F054 and EBS C006154 are PTT calibration routines, never "software updates".
- Be concise and direct: plain sentences, no markdown, no filler such as "check the harness" without naming the connector or ECU.

Return ONLY one strict JSON object with exactly the keys verdictHeadline, collateralDamageAnalysis, untouchedBlockersSummary, repeatFaultEscalation, nextFloorActions.`

// Hand-written JSON Schema for OpenAI Structured Outputs (strict mode): every
// key required, optional values as nullable types, no unsupported keywords.
// `pttVerificationAuditSchema` re-validates the output.
export const VERIFICATION_AUDIT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "verdictHeadline",
    "collateralDamageAnalysis",
    "untouchedBlockersSummary",
    "repeatFaultEscalation",
    "nextFloorActions",
  ],
  properties: {
    verdictHeadline: { type: "string" },
    collateralDamageAnalysis: { type: ["string", "null"] },
    untouchedBlockersSummary: { type: ["string", "null"] },
    repeatFaultEscalation: { type: ["string", "null"] },
    nextFloorActions: { type: "array", items: { type: "string" } },
  },
} as const

/** The user message: the deterministic reconciliation, exceptions as context only. */
export function buildVerificationAuditPayload(
  input: VerificationAuditInput
): string {
  return JSON.stringify({ mode: "VERIFICATION_AUDIT", ...input }, null, 1)
}

/**
 * Forensic audit of one verification re-scan. The result is passed through
 * `normalizeVerificationAudit`, so the "required whenever" contracts always
 * hold even if the model leaves a field empty.
 */
export async function generateVerificationForensicAudit(options: {
  openai: OpenAI
  model: string
  input: VerificationAuditInput
  timeoutMs?: number
}): Promise<PttVerificationAudit> {
  const { openai, model, input } = options
  const audit = await runJsonPass(
    openai,
    "Verification forensic audit",
    pttVerificationAuditSchema,
    {
      model,
      temperature: 0.1,
      max_tokens: VERIFICATION_AUDIT_MAX_TOKENS,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ptt_verification_forensic_audit",
          strict: true,
          schema: VERIFICATION_AUDIT_JSON_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: VERIFICATION_AUDIT_SYSTEM_PROMPT },
        { role: "user", content: buildVerificationAuditPayload(input) },
      ],
    },
    options.timeoutMs ?? VERIFICATION_AUDIT_TIMEOUT_MS
  )
  return normalizeVerificationAudit(audit, input)
}
