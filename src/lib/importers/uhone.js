// UnitedHealthOne "ActiveSubProducers" export — ancillary products (not
// Medicare Advantage). One row per producer × appointment state; statuses are
// Active / Pending (Pending = not ready yet, RTS N). These appointments are
// tracked in the app but deliberately EXCLUDED from the Sunfire export and the
// Coverage gap math — see NON_SUNFIRE_CARRIERS (sunfireExport.js) and
// ANCILLARY_CARRIERS (coverageModel.js).
import { readCsv, rowsToObjects, clean } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'uhone',
  label: 'UnitedHealthOne Active SubProducers',
  accept: '.csv',
  target: 'carrier_appointments',
}

export async function parseFile(file, opts = {}) {
  const rows = rowsToObjects(await readCsv(file))
  const out = []
  const seen = new Set()
  for (const r of rows) {
    const npn = clean(r['National Producer Number'])
    if (!npn) continue
    const state = toStateCode(r['Appointment State'])
    if (!state) continue
    const key = `${npn}|${state}`
    if (seen.has(key)) continue   // guard against duplicate rows in the file
    seen.add(key)
    const active = clean(r['Appointment Status'])?.toLowerCase() === 'active'
    out.push({
      agent_npn: npn,
      first_name: clean(r['First Name']),
      last_name:  clean(r['Last Name']),
      email:      clean(r['Email']),
      carrier:    'UnitedHealthOne',
      plan_year:  opts.planYear || 2026,
      writing_number: clean(r['BrokerVueID']),
      state,
      product_category: 'Ancillary',
      rts_status: active ? 'Y' : 'N',
    })
  }
  return { appointments: out }
}
