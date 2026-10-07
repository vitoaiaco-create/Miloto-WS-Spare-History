export const FLEET_TAXONOMY = {
  "1. ENGINE & POWERTRAIN": {
    "Engine Mechanicals": ["Blocks, Heads & Valvetrain", "Pistons, Rings & Liners", "Engine Mounts & Dampers", "Engine Seals & Gaskets", "Oil Pumps & Filtration"],
    "Fuel & Air Induction": ["Fuel Tanks & Lines", "Fuel Pumps & Injectors", "Air Filtration", "Turbochargers & Manifolds"],
    "Cooling System": ["Radiators & Coolers", "Belts & Tensioners"],
    "Drivetrain & Transmission": ["Gearboxes & PTOs", "Clutches & Flywheels", "Driveshafts & U-Joints", "Differentials & Final Drives"]
  },
  "2. CABIN, BODY & CHASSIS": {
    "Cabin Components & HVAC": ["AC Compressors & Evaporators", "Cab Trim & Interior Accessories", "Seats & Restraints"],
    "Body, Glass & Mirrors": ["Panels, Doors & Mounts", "Windshields & Windows", "Mirrors & Brackets", "Wipers & Washers"],
    "Structural Chassis & Towing": ["Chassis Rails & Crossmembers", "Bumpers & Bullbars", "Fifth Wheels & Kingpins", "Cabin Suspension & Shocks"]
  },
  "3. SUSPENSION, STEERING & AXLES": {
    "Axles & Hubs": ["Hub Assemblies", "Wheel Bearings & Seals", "Wheel Studs & Nuts"],
    "Steering Components": ["Steering Boxes & Racks", "Power Steering Pumps & Reservoirs", "Tie Rods & Drag Links", "Steering Linkages & Kingpins"],
    "Suspension Systems": ["Leaf Springs & U-Bolts", "Air Springs (Bags)", "Shock Absorbers & Bushes", "Hardware & Brackets"]
  },
  "4. BRAKES & PNEUMATICS": {
    "Foundation Brakes": ["Brake Drums & Rotors", "Brake Shoes, Pads & Linings", "Slack Adjusters & Calipers"],
    "Brake Actuation & Control": ["Brake Boosters & Chambers", "Air Valves & Governors", "ABS Sensors & ECUs"],
    "Air Lines & Fittings": ["Hoses, Pipes & Tubes", "Push-in Fittings & Couplers"]
  },
  "5. HYDRAULICS": {
    "Hydraulic Pumps & Motors": ["Gear & Piston Pumps"],
    "Cylinders & Rams": ["Cylinder Rods & Barrels", "Seal Kits"],
    "Hydraulic Lines & Fittings": ["High-Pressure Hoses & Fittings", "Valves & Controls"]
  },
  "6. CONSUMABLES, SERVICE & WEAR": {
    "Service Parts": ["Filters (Air/Oil/Fuel)", "Fluids & Lubricants", "Tyres & Tyre Accessories"],
    "Fasteners & Hardware": ["Hardware & Brackets (Nuts/Bolts/Raw Steel)", "O-Rings, Seals & Gaskets"],
    "Workshop & General": ["Workshop Consumables", "Bulk Paint & Thinners"]
  },
  "7. ELECTRICAL & INSTRUMENTATION": {
    "Starting & Charging": ["Batteries & Cables", "Starters & Alternators"],
    "Lighting & Signage": ["Headlights & Worklights", "Beacons & Tail Lights", "Bulbs & Lenses"],
    "Sensors & Wiring": ["Wiring Harnesses & Relays", "Pressure & Temp Switches", "Dash Instruments & Gauges"]
  }
} as const;

export type Tier1 = keyof typeof FLEET_TAXONOMY;

export const TIER_1_OPTIONS = Object.keys(FLEET_TAXONOMY) as Tier1[]

export function isTier1(value: string): value is Tier1 {
  return Object.prototype.hasOwnProperty.call(FLEET_TAXONOMY, value)
}

export function getTier2Options(tier1: string): string[] {
  if (!isTier1(tier1)) return []
  return Object.keys(FLEET_TAXONOMY[tier1])
}

export function getTier3Options(tier1: string, tier2: string): string[] {
  if (!isTier1(tier1) || !tier2) return []

  const branch = FLEET_TAXONOMY[tier1]
  if (!Object.prototype.hasOwnProperty.call(branch, tier2)) return []

  return [...branch[tier2 as keyof typeof branch]]
}

// Drops Tier 2/3 values that are not children of the selected parent in
// `FLEET_TAXONOMY`. An unknown Tier 1 clears the whole path so the
// Pre-Ingestion Review dropdowns never show a combination that cannot
// actually be selected.
export function sanitizeTaxonomyTiers(input: {
  tier1?: string | null
  tier2?: string | null
  tier3?: string | null
}): { tier1: string; tier2: string; tier3: string } {
  const tier1 = input.tier1?.trim() ?? ""
  const tier2 = input.tier2?.trim() ?? ""
  const tier3 = input.tier3?.trim() ?? ""

  if (!isTier1(tier1)) {
    return { tier1: "", tier2: "", tier3: "" }
  }

  if (!getTier2Options(tier1).includes(tier2)) {
    return { tier1, tier2: "", tier3: "" }
  }

  if (!getTier3Options(tier1, tier2).includes(tier3)) {
    return { tier1, tier2, tier3: "" }
  }

  return { tier1, tier2, tier3 }
}

export function isCompleteTaxonomyPath(
  tier1: string,
  tier2: string,
  tier3: string
) {
  const sanitized = sanitizeTaxonomyTiers({ tier1, tier2, tier3 })
  return (
    sanitized.tier1 !== "" &&
    sanitized.tier2 !== "" &&
    sanitized.tier3 !== "" &&
    sanitized.tier1 === tier1 &&
    sanitized.tier2 === tier2 &&
    sanitized.tier3 === tier3
  )
}
