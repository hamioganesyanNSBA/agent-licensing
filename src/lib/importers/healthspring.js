// Cigna Healthspring appointment report (CSV).
// Columns (0-indexed): 0 First Name, 1 Last Name, 2 Producer Type, 3 Sub Type,
// 4 NPN, 5 Broker Status, 6 Status Reason, 7 LOB, 8 State, 9 State Status,
// 10 State Status Reason. Row 0 is the header. File uses \r line endings, which
// readCsv normalizes.
//
// We import Medicare Advantage rows only (LOB / col H = "MA"). An agent counts
// as appointed / ready-to-sell (rts_status = Y) when the State Status (col J)
// is "Active/Certified"; anything else (Suspended, Terminated) is N.
import { readCsv, clean } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'healthspring',
  label: 'Cigna Healthspring Appointment Report',
  accept: '.csv',
  target: 'carrier_appointments',
}

export async function parseFile(file) {
  const rows = await readCsv(file)
  const out = []
  for (let i = 1; i < rows.length; i++) {   // row 0 = header
    const r = rows[i]
    const npn = clean(r[4])
    if (!npn || !/^\d+$/.test(npn)) continue
    if (clean(r[7]) !== 'MA') continue       // LOB (col H): Medicare Advantage only
    const state = toStateCode(r[8])          // State (col I)
    if (!state) continue
    const ready = (clean(r[9]) || '').toLowerCase() === 'active/certified' // State Status (col J)
    out.push({
      agent_npn: npn,
      first_name: clean(r[0]),
      last_name:  clean(r[1]),
      email:      null,
      carrier:    'Cigna',
      plan_year:  2026,
      writing_number: null,
      state,
      product_category: 'MA',
      rts_status: ready ? 'Y' : 'N',
    })
  }
  return { appointments: out }
}
