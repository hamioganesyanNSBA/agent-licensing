// Shared coverage/gap model used by the Coverage page and the Agents list.
// For every active agent (NPN present in licenses), compares states with an
// active unexpired license — restricted to each carrier's plan footprint —
// against RTS=Y appointment states for the latest plan year.
import { statesInFootprint } from './carrierFootprints.js'

export const KNOWN_CARRIERS = ['Aetna', 'Anthem', 'Cigna', 'Devoted', 'SCAN', 'UnitedHealthcare', 'Wellcare', 'Zing']
export const CARRIER_SHORT = { UnitedHealthcare: 'UHC' }

export function buildCoverageModel(licenses, appointments, agents) {
  const today = new Date().toISOString().slice(0, 10)

  // Active licensed states per NPN (usable license = Active and not expired).
  const licensedByNpn = new Map()
  for (const l of licenses) {
    if (l.status !== 'Active') continue
    if (l.expiration_date && l.expiration_date < today) continue
    if (!licensedByNpn.has(l.npn)) licensedByNpn.set(l.npn, new Set())
    licensedByNpn.get(l.npn).add(l.state)
  }

  // Latest plan year in the data drives the comparison.
  const planYear = Math.max(...appointments.map(a => a.plan_year || 0), 0)

  // RTS=Y states per NPN x carrier for that plan year.
  const rtsByNpn = new Map()
  const carriersInData = new Set()
  for (const a of appointments) {
    if (a.plan_year !== planYear || a.rts_status !== 'Y') continue
    carriersInData.add(a.carrier)
    if (!rtsByNpn.has(a.agent_npn)) rtsByNpn.set(a.agent_npn, new Map())
    const byCarrier = rtsByNpn.get(a.agent_npn)
    if (!byCarrier.has(a.carrier)) byCarrier.set(a.carrier, new Set())
    byCarrier.get(a.carrier).add(a.state)
  }

  // Always show every tracked carrier, plus any unexpected values in the data.
  const carriers = [...KNOWN_CARRIERS,
    ...[...carriersInData].filter(c => !KNOWN_CARRIERS.includes(c))]

  const nameByNpn = new Map(agents.map(a => [a.npn, `${a.last_name || ''}, ${a.first_name || ''}`]))
  const rows = [...licensedByNpn.keys()].map(npn => {
    const licensed = licensedByNpn.get(npn)
    const byCarrier = rtsByNpn.get(npn) || new Map()
    const cells = carriers.map(carrier => {
      const rts = byCarrier.get(carrier) || new Set()
      // Only states where the carrier actually sells plans count.
      const sellable = statesInFootprint(carrier, licensed)
      const covered = sellable.filter(s => rts.has(s))
      const missing = sellable.filter(s => !rts.has(s)).sort()
      const level = sellable.length === 0 ? 'na'
        : covered.length === 0 ? 'none'
        : missing.length === 0 ? 'full' : 'partial'
      return { carrier, covered: covered.length, total: sellable.length, missing, level }
    })
    const gapCount = cells.filter(c => c.level === 'none' || c.level === 'partial').length
    return { npn, name: nameByNpn.get(npn) || npn, licensed: [...licensed].sort(), cells, gapCount }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const perCarrierMissing = carriers.map((c, i) => rows.filter(r => r.cells[i].level === 'none').length)
  return { planYear, carriers, rows, perCarrierMissing,
    byNpn: new Map(rows.map(r => [r.npn, r])),
    fullyCovered: rows.filter(r => r.gapCount === 0).length }
}
