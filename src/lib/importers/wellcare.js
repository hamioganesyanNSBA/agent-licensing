// Wellcare appointments CSV.
// Header: First Name, Last Name, Producer Type, Sub Type, NPN, State,
//   Start Date, End Date, Rule Name, Cocode, Company, LOA Product,
//   Appointment Method, Appointment Status
import { readCsv, rowsToObjects, clean } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'wellcare',
  label: 'Wellcare Appointments',
  accept: '.csv',
  target: 'carrier_appointments',
}

const PRODUCT_MAP = {
  'MA - Comm': 'MA',
  'MA':        'MA',
  'CCP':       'MA',
  'PDP':       'PDP',
}

export async function parseFile(file) {
  const rows = await readCsv(file)
  const objects = rowsToObjects(rows, 0)
  const out = []
  for (const r of objects) {
    const npn = clean(r['NPN'])
    if (!npn) continue
    const state = toStateCode(r['State'])
    if (!state) continue
    const status = (clean(r['Appointment Status']) || '').toLowerCase()
    const ready = status === 'appointed'
    const loa = clean(r['LOA Product']) || ''
    const product = PRODUCT_MAP[loa] || loa
    out.push({
      agent_npn:  npn,
      first_name: clean(r['First Name']),
      last_name:  clean(r['Last Name']),
      email:      null,
      carrier:    'Wellcare',
      plan_year:  2026,
      writing_number: npn,
      state,
      product_category: product,
      rts_status: ready ? 'Y' : 'N',
    })
  }
  return { appointments: out }
}
