// Carrier plan footprints — the states where each carrier actually SELLS
// Medicare Advantage plans for the current plan year. Used by the Coverage
// page so agents aren't flagged as "missing" an appointment in a state where
// the carrier has no plans to sell.
//
// ⚠️ Verified for PLAN YEAR 2026 (researched July 2026). Re-verify each AEP —
// carriers enter/exit states every year.
//
// `null` = treated as nationwide (no restriction). Used for the near-national
// carriers where a precise list adds little and risks hiding real gaps.
export const CARRIER_FOOTPRINTS = {
  // scanhealthplan.com/en/states-and-counties — 6 states for 2026 (WA new).
  SCAN: new Set(['AZ', 'CA', 'NM', 'NV', 'TX', 'WA']),

  // myzinghealth.com + medicare.org 2026 plan listings (IL/IN, MI, TN/MS).
  Zing: new Set(['IL', 'IN', 'MI', 'MS', 'TN']),

  // devoted.com/service-area — 29 states for 2026.
  Devoted: new Set([
    'AL', 'AR', 'AZ', 'CO', 'DE', 'FL', 'GA', 'HI', 'IA', 'IL', 'IN', 'KS',
    'KY', 'LA', 'MO', 'MS', 'NC', 'NE', 'NM', 'OH', 'OK', 'OR', 'PA', 'SC',
    'TN', 'TX', 'UT', 'VA', 'WA',
  ]),

  // Elevance: Anthem BCBS brand (14 states) + Wellpoint brand MA states —
  // NSBA's Anthem RTS report spans both brands, so we use the union.
  Anthem: new Set([
    'CA', 'CO', 'CT', 'GA', 'IN', 'KY', 'ME', 'MO', 'NH', 'NV', 'NY', 'OH',
    'VA', 'WI',                                    // Anthem BCBS
    'AZ', 'FL', 'IA', 'KS', 'NJ', 'TN', 'TX', 'WA', // Wellpoint
  ]),

  // Near-national for 2026 — leave unrestricted so real gaps are never hidden:
  // Aetna (MAPD in 43 states + DC), UHC (~national), Wellcare (MA in 32
  // states + national PDP), Cigna/HealthSpring (29 states + DC, exact list
  // not published).
  Aetna: null,
  UnitedHealthcare: null,
  Wellcare: null,
  Cigna: null,
}

/** States (from `licensedStates`) where `carrier` actually sells plans. */
export function statesInFootprint(carrier, licensedStates) {
  const fp = CARRIER_FOOTPRINTS[carrier]
  if (!fp) return [...licensedStates]
  return [...licensedStates].filter(s => fp.has(s))
}
