// Reference schedules of tire damage types and suspension faults with their
// point deductions, shown on the Scoring Rules tab of the Asset Rankings
// dashboard (`src/components/logistics-dashboard.tsx`).
//
// NOTE: actual tire penalties are recorded per-incident via the processed
// tire-scrapping penalties CSV (see `tirePenaltyRowSchema` in
// `src/lib/validations.ts` and `TirePenaltyUploader`), where each row
// carries its own free-form reason and point value. These configs do not
// drive that calculation — they're documented reference schedules for
// staff to see, at a glance, how each damage type / fault is normally
// scored.
//
// Finalized point deductions, extracted from the processed CSV uploads.
export const TIRE_PENALTY_CONFIG: { damageType: string; points: number }[] = [
  { damageType: "Impact Damage", points: -20 },
  { damageType: "Sidewall Damage", points: -20 },
  { damageType: "Penetration Injury", points: -10 },
  { damageType: "Shoulder Damage", points: -10 },
  { damageType: "Shoulder Rib Tear", points: -10 },
  { damageType: "Tread Damaged", points: -10 },
  { damageType: "Crown Damage", points: -5 },
]

// Finalized suspension job-card faults and their point deductions, matched
// against the part/material names on the processed job-card CSV.
export const SUSPENSION_PENALTY_FAULTS: { fault: string; points: number }[] = [
  { fault: "M14X200MM CENTRE BOLTS 1189", points: -5 },
  { fault: "CENTRE BOLT M14 X  165MM HENRE", points: -5 },
  { fault: "CENTRE BOLT M14 X 145 HENRED", points: -5 },
  { fault: "BOTTOM PLATE AXLE SEAT ASSY 12", points: -10 },
  { fault: "WEAR PLATE SG000301", points: -10 },
  { fault: "FIXED  SOLID ARM SE000101", points: -10 },
  { fault: "ADJUSTABLE  RADUIS ROD  ARM HE", points: -5 },
  { fault: "HANGER ASSY REAR SH000201", points: -10 },
  { fault: "HANGER FRONT F-SUSP. TAPERED", points: -10 },
  { fault: "HENRED 8 BLADES HEAVY DUTY SPR", points: -20 },
  { fault: "HENRED ROCKER BOX SR000101F", points: -10 },
  { fault: "HENRED MIDDLE ROCKER HANGER F-", points: -10 },
  { fault: "HENRED ROCKER BOX HSR000101F", points: -10 },
  { fault: "RADIUS PIN SLITLY LONGER", points: -5 },
  { fault: "RA001 RADIUS PIN SLITLY LONGER", points: -5 },
  { fault: "RADIUS PINS XP009401AT", points: -5 },
  { fault: "ROCKER PIN FORGED HENRED XP800", points: -5 },
  { fault: "SUSPENSION BPW ADJUSTABLE TORQ", points: -10 },
  { fault: "TOP SADDLE ASSEMBLY SO000501", points: -10 },
  { fault: "U-BOLT 350X80X22F-SUS 127DIA -", points: -5 },
  { fault: "U-BOLT 280X130X22.L 8 SSN - U", points: -5 },
  { fault: "U-BOLT 350X80X22F-SUS 127DIA C", points: -5 },
  { fault: "LEAF SPRING HENRED 2nd 76x16mm", points: -20 },
  { fault: "V-STAY BALL TYPE V2 FOR VOLVO", points: -10 },
  { fault: "SKF V-STAY, BALL TYPE  VKDCV12", points: -10 },
  { fault: "DRAG LINK 2.25138 V4", points: -10 },
  { fault: "SKF DRAG LINK VKDCV4044", points: -10 },
  { fault: "DRAG LINK, 863M, I-SHIFT VOLVO", points: -10 },
  { fault: "KING PIN KIT WITH BEARING 2.95", points: -10 },
  { fault: "ENGINE MOUNTING RUBBER CUSHION", points: -10 },
  { fault: "ENGINE MOUNT REAR VERSION 4 A-", points: -10 },
  { fault: "LEMA REAR ENGINE MOUNTING 1385", points: -10 },
  { fault: "REAR ENGINE MOUNT M20X2.5 10.9", points: -10 },
  { fault: "RUBBER MOUNTING 2.10397 207470", points: -10 },
  { fault: "CABIN FRONT SHOCK ABSORBER CB0", points: -5 },
  { fault: "CABIN REAR SHOCK ABSORBER CB01", points: -5 },
  { fault: "CABIN SHOCK ABSORBER 2.61278", points: -5 },
  { fault: "CABIN SHOCK ABSORBER V4 CROSS", points: -5 },
  { fault: "CABIN SHOCK ABSORBER, CROSS RE", points: -5 },
  { fault: "CABIN SHOCK ABSORBER, WITH AIR", points: -5 },
  { fault: "CABIN SHOCK ABSORBERS FM440 VO", points: -5 },
  { fault: "CABIN SHOCK REAR LONG 30007403", points: -5 },
  { fault: "CABIN SHOCK, AIR BELLOW, FRONT", points: -5 },
  { fault: "CABIN SHOCK, AIR BELLOW, REAR", points: -5 },
  { fault: "FRONT AXLE SHOCK ABSORBER 2.61", points: -10 },
  { fault: "FRONT AXLE SHOCK ABSORBERS 2.6", points: -10 },
  { fault: "FRONT SHOCK ABSORBER 316525", points: -10 },
  { fault: "REAR DIFF SHOCK ABSORBER  VOLV", points: -10 },
  { fault: "SMALL FRONT CABIN SHOCK ABSORB", points: -5 },
  { fault: "SHOCK ABSORBER FOR VOLVO SAB89", points: -10 },
  { fault: "SHOCK ABSORBER CB0204", points: -10 },
  { fault: "SHOCK ABSORBER FH REAR VOLVO V", points: -10 },
  { fault: "SHOCK ABSORBER CB0040", points: -10 },
  { fault: "SHOCK ABSORBER 312706", points: -10 },
  { fault: "TRUCK TRANSVERSAL TIE ROD 2.5", points: -10 },
  { fault: "SKF TRACK ROD VKDCV04008", points: -10 },
  { fault: "HOLLOW SPRING, DIFF SPRING SUS", points: -10 },
  { fault: "STABILIZER STAY, FRONT C22 X 3", points: -10 },
  { fault: "STABILIZER CONTROL ARM SECOND", points: -10 },
  { fault: "REPAIR KIT, BOGIE V2 2.96004", points: -10 },
  { fault: "V4 FRONT LEAF SPRING D13A", points: -20 },
  { fault: "V3 SECOND-HAND FRONT LEAF SPRI", points: -20 },
]
