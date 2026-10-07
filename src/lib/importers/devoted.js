// Devoted Health RTS report (CSV or XLSX). One row per agent x plan year x
// state, with the plan year in the file (both the current and next year), so
// the Imports page's plan-year selector does not apply. RTS=Y when "Is
// Approved" is Yes — in the files we've seen, Yes only ever occurs for ACTIVE
// agents, so the agent status column doesn't need to be checked separately.
//
// Three flavours, same columns underneath:
//  - Legacy portal export (CSV): "Sales Agent Info Sales Agent Npn", "Sales
//    Agent Ready to Sell Yearly Plan Year", "... Is Approved (Yes / No)", ...
//  - `<Firm>_Devoted_RTS_<timestamp>.csv`: upper snake case
//    (SALES_AGENT_INFO_SALES_AGENT_NPN, SALES_AGENT_READY_TO_SELL_YEARLY_
//    PLAN_YEAR, ..._IS_APPROVED_YES_NO), plus extra columns (Carrier, npn,
//    First_Name/Last_Name, agent status, certification/resident flags,
//    hierarchy lineage) we don't need.
//  - `<Firm>_Devoted_RTS_<timestamp>.xlsx`: single "Sheet1", the portal's
//    title-case headers again, and literal "NULL" strings in blank cells.
// Headers are matched by headerKey() and "NULL" is blank (see parse.js), so
// all three map to the same keys.
import { readTable, headerKey, cleanNull } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'devoted',
  label: 'Devoted Health RTS Report',
  accept: '.csv,.xlsx,.xls',
  target: 'carrier_appointments',
}

const COL = {
  npn:      headerKey('Sales Agent Info Sales Agent Npn'),
  first:    headerKey('Sales Agent Info First Name'),
  last:     headerKey('Sales Agent Info Last Name'),
  email:    headerKey('Sales Agent Info Sales Agent Email'),
  year:     headerKey('Sales Agent Ready to Sell Yearly Plan Year'),
  state:    headerKey('Sales Agent Ready to Sell Yearly State'),
  approved: headerKey('Sales Agent Ready to Sell Yearly Is Approved (Yes / No)'),
}

export async function parseFile(file) {
  const rows = await readTable(file, { label: 'Devoted' })
  const idx = Object.fromEntries((rows[0] || []).map((h, i) => [headerKey(h), i]))
  for (const k of ['npn', 'year', 'state', 'approved']) {
    if (!(COL[k] in idx)) {
      throw new Error('This doesn\'t look like a Devoted Health report — expected the "Sales Agent Info ..." / SALES_AGENT_READY_TO_SELL_YEARLY_... columns. Nothing was imported.')
    }
  }
  const get = (r, k) => cleanNull(r[idx[COL[k]]])

  const out = []
  for (const r of rows.slice(1)) {
    const npn = get(r, 'npn')
    if (!npn || !/^\d+$/.test(npn)) continue
    const state = toStateCode(get(r, 'state'))
    const planYear = parseInt(get(r, 'year'), 10)
    if (!state || !planYear) continue
    const approved = (get(r, 'approved') || '').toLowerCase() === 'yes'
    out.push({
      agent_npn: npn,
      first_name: get(r, 'first'),
      last_name:  get(r, 'last'),
      email:      get(r, 'email'),
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
