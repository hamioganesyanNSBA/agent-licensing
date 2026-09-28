// Shared step for the AEP-readiness files that name certified agents but carry
// no states (Centene ProStat for Wellcare, HCSC training for Cigna, SCAN
// training). States come from the carrier's rows already in the DB for the
// latest plan year before the AEP year; each is copied to the AEP year with
// RTS=Y when the base row is Y AND the agent is in `certified`. Only AEP-year
// rows are emitted — the current year is never touched.
import { fetchAll } from '../fetchAll.js'

export async function aepRowsFromBase(carrier, aepYear, certified, firstUpload) {
  const existing = await fetchAll('carrier_appointments',
    'agent_npn,first_name,last_name,writing_number,plan_year,state,product_category,rts_status',
    { eq: { carrier } })
  const baseYears = existing.map(r => r.plan_year).filter(y => y < aepYear)
  if (!baseYears.length) {
    throw new Error(`No ${carrier} data before ${aepYear} is loaded yet — upload ${firstUpload} first, then this file. Nothing was imported.`)
  }
  const baseYear = Math.max(...baseYears)
  return existing
    .filter(r => r.plan_year === baseYear)
    .map(r => ({
      agent_npn:  r.agent_npn,
      first_name: r.first_name,
      last_name:  r.last_name,
      email:      null,
      carrier,
      plan_year:  aepYear,
      writing_number: r.writing_number || r.agent_npn,
      state:      r.state,
      product_category: r.product_category,
      rts_status: r.rts_status === 'Y' && certified.has(r.agent_npn) ? 'Y' : 'N',
    }))
}
