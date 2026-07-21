// Shared parser for the "ProStat" carrier appointment reports (Cigna
// Healthspring, SCAN, Zing). All share the same columns (0-indexed):
// 0 First Name, 1 Last Name, 2 Producer Type, 3 Sub Type, 4 NPN, 5 Broker
// Status, 6 Status Reason, 7 LOB, 8 State, 9 State Status, 10 State Status
// Reason (Zing adds an 11 AEP Status column, which we ignore). Row 0 is the
// header; files use \r line endings, which readCsv normalizes.
//
// We import Medicare Advantage rows only (LOB / col H = "MA"). An agent counts
// as appointed / ready-to-sell (rts_status = Y) when the State Status (col J)
// is "Active/Certified"; anything else (Suspended, Terminated) is N.
import { readCsv, clean } from '../parse.js'
import { toStateCode } from '../states.js'

export async function parseProStat(file, carrier) {
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
      carrier,
      plan_year:  2026,
      writing_number: null,
      state,
      product_category: 'MA',
      rts_status: ready ? 'Y' : 'N',
    })
  }
  return { appointments: out }
}
