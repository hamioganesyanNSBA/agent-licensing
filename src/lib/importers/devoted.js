// Devoted Health appointments CSV.
import { readCsv, rowsToObjects, clean } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'devoted',
  label: 'Devoted Health Appointments',
  accept: '.csv',
  target: 'carrier_appointments',
}

export async function parseFile(file) {
  const rows = await readCsv(file)
  const objects = rowsToObjects(rows, 0)
  const out = []
  for (const r of objects) {
    const npn = clean(r['Sales Agent Info Sales Agent Npn'])
    if (!npn) continue
    const state = toStateCode(r['Sales Agent Ready to Sell Yearly State'])
    const planYear = parseInt(clean(r['Sales Agent Ready to Sell Yearly Plan Year']), 10)
    if (!state || !planYear) continue
    const approved = (clean(r['Sales Agent Ready to Sell Yearly Is Approved (Yes / No)']) || '').toLowerCase() === 'yes'
    out.push({
      agent_npn: npn,
      first_name: clean(r['Sales Agent Info First Name']),
      last_name:  clean(r['Sales Agent Info Last Name']),
      email:      clean(r['Sales Agent Info Sales Agent Email']),
      carrier:    'Devoted',
      plan_year:  planYear,
      writing_number: npn,
      state,
      product_category: 'MA',
      rts_status: approved ? 'Y' : 'N',
    })
  }
  return { appointments: out }
}
