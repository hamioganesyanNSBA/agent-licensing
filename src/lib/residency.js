import { fetchAll } from './fetchAll.js'

// Resident-state helpers. `licenses.is_resident` comes from the Onyx sync
// (NIPR residency flag): true = the agent's resident-state license, false =
// non-resident, null = the sync hasn't populated it yet.

/**
 * Pick the agent's resident state from their license rows.
 * Prefers an Active resident license; falls back to any resident license.
 * Returns the 2-letter state code, or null if unknown.
 */
export function residentStateOf(licenses) {
  let fallback = null
  for (const l of licenses || []) {
    if (l.is_resident !== true || !l.state) continue
    if (l.status === 'Active') return l.state
    if (!fallback) fallback = l.state
  }
  return fallback
}

/** Map of npn -> resident state code (only agents with a known resident state). */
export function residentStatesByNpn(licenses) {
  const byNpn = new Map()
  for (const l of licenses || []) {
    if (!byNpn.has(l.npn)) byNpn.set(l.npn, [])
    byNpn.get(l.npn).push(l)
  }
  const out = new Map()
  for (const [npn, rows] of byNpn) {
    const st = residentStateOf(rows)
    if (st) out.set(npn, st)
  }
  return out
}

/**
 * fetchAll('licenses', …) including `is_resident`, falling back to the same
 * select without it when the database hasn't run the ALTER yet (rows then
 * carry is_resident: null, which the UI shows as "unknown").
 */
export async function fetchLicensesWithResidency(select, filters) {
  try {
    return await fetchAll('licenses', `${select},is_resident`, filters)
  } catch (e) {
    if (!/is_resident/.test(e?.message || '')) throw e
    const rows = await fetchAll('licenses', select, filters)
    return rows.map(r => ({ ...r, is_resident: null }))
  }
}

/** True when no license row has residency populated (sync predates the column). */
export function residencyUnknown(licenses) {
  return (licenses || []).length > 0 && licenses.every(l => l.is_resident == null)
}
