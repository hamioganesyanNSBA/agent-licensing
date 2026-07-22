// Wellcare appointments/licensure CSV. Wellcare has shipped two formats, so we
// detect by header and handle both:
//
// New format (producer license report) — header: First Name, Last Name,
//   Producer Type, Sub Type, NPN, State, Status, Residency, License Number,
//   Class Name, LOA Name, Effective Date, Expiration Date.
//   One row per state license. Rule: RTS=Y when any row for an NPN x state has
//   Status = Active (Inactive/Deleted/Cancelled -> N), product = MA. Rows are
//   deduped to one appointment per NPN x state (Y wins over N).
//
// Old format (appointment report) — header: First Name, Last Name, Producer
//   Type, Sub Type, NPN, State, Start Date, End Date, Rule Name, Cocode,
//   Company, LOA Product, Appointment Method, Appointment Status.
//   Rule: RTS=Y when Appointment Status = Appointed; product from LOA Product.
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

function baseRow(r, npn, state) {
  return {
    agent_npn:  npn,
    first_name: clean(r['First Name']),
    last_name:  clean(r['Last Name']),
    email:      null,
    carrier:    'Wellcare',
    plan_year:  2026,
    writing_number: npn,
    state,
    product_category: 'MA',
    rts_status: 'N',
  }
}

export async function parseFile(file) {
  const rows = await readCsv(file)
  const objects = rowsToObjects(rows, 0)
  const headers = rows[0].map(h => String(h ?? '').trim())
  const isLicenseFormat = headers.includes('Status') && !headers.includes('Appointment Status')

  if (isLicenseFormat) {
    // New license-report format: dedupe to one row per NPN x state, Y if any Active.
    const byKey = new Map()
    for (const r of objects) {
      const npn = clean(r['NPN'])
      if (!npn) continue
      const state = toStateCode(r['State'])
      if (!state) continue
      const active = (clean(r['Status']) || '').toLowerCase() === 'active'
      const key = `${npn}|${state}`
      let row = byKey.get(key)
      if (!row) { row = baseRow(r, npn, state); byKey.set(key, row) }
      if (active) row.rts_status = 'Y'
    }
    return { appointments: [...byKey.values()] }
  }

  // Old appointment-report format.
  const out = []
  for (const r of objects) {
    const npn = clean(r['NPN'])
    if (!npn) continue
    const state = toStateCode(r['State'])
    if (!state) continue
    const status = (clean(r['Appointment Status']) || '').toLowerCase()
    const loa = clean(r['LOA Product']) || ''
    out.push({
      ...baseRow(r, npn, state),
      product_category: PRODUCT_MAP[loa] || loa,
      rts_status: status === 'appointed' ? 'Y' : 'N',
    })
  }
  return { appointments: out }
}
