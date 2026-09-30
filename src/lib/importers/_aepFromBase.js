// Shared step for the AEP-readiness files that name certified agents but carry
// no states (Centene ProStat for Wellcare, HCSC training for Cigna, SCAN /
// Zing training, Molina certification). States come from the carrier's rows
// already in the DB for the latest plan year before the AEP year; each is
// copied to the AEP year with RTS=Y when the base row is Y AND the agent is
// in `certified`. Only AEP-year rows are emitted — the current year is never
// touched.
import { fetchAll } from '../fetchAll.js'
import { parseCsv, rowsToObjects, clean } from '../parse.js'

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

// The carrier-portal "training" / "certification" exports (SCAN, Zing,
// Molina) share one shape: First Name, Last Name, Producer Type, Sub Type,
// NPN, Year, <Training|Certification> Name, <Training|Certification>
// Progress, Start Date, End Date — one row per agent x year x course, no
// states. An agent is certified for the AEP year (latest Year in the file)
// when any of their rows for that year passes `isCert(name, progress)`.
export const TRAINING_HEADER = /^First Name,Last Name,.*,NPN,Year,(Training|Certification) Name,(Training|Certification) Progress/i

export async function aepRowsFromTrainingReport(text, { carrier, label, isCert, firstUpload }) {
  const objects = rowsToObjects(parseCsv(text), 0)
  const year = r => parseInt(clean(r['Year']), 10)
  const aepYear = Math.max(...objects.map(year).filter(Number.isFinite))
  if (!Number.isFinite(aepYear)) {
    throw new Error(`No years found in this ${label} — the file has no agent rows. Nothing was imported.`)
  }
  const certified = new Set()
  for (const r of objects) {
    const npn = clean(r['NPN'])
    if (!npn || year(r) !== aepYear) continue
    const name = (clean(r['Training Name'] ?? r['Certification Name']) || '').toLowerCase()
    const progress = parseFloat(clean(r['Training Progress'] ?? r['Certification Progress']))
    if (isCert(name, progress)) certified.add(npn)
  }
  return aepRowsFromBase(carrier, aepYear, certified, firstUpload)
}
