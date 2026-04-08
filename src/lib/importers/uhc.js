// UHC Readiness Report — sheet "L&A".
// Layout: hierarchy levels, agent identity columns, then one column per state
// (2-letter code) with values 'C' (certified/ready) or 'N' (not).
import { readWorkbook, sheetToRows, clean } from '../parse.js'

export const meta = {
  key: 'uhc',
  label: 'UnitedHealthcare Readiness Report',
  accept: '.xlsx,.xls',
  target: 'carrier_appointments',
}

const STATE_RE = /^[A-Z]{2}$/

export async function parseFile(file) {
  const wb = await readWorkbook(file)
  const ws = wb.Sheets['L&A']
  if (!ws) throw new Error('UHC file missing "L&A" sheet')
  const rows = sheetToRows(ws)
  const headers = rows[0].map(h => clean(h))
  const idx = (name) => headers.indexOf(name)
  const iName = idx('Agent Name')
  const iNpn  = idx('NIPR Number')
  const stateCols = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h && STATE_RE.test(h))

  const out = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const npn = clean(row[iNpn])
    if (!npn) continue
    const name = clean(row[iName]) || ''
    const [last, first] = name.split(',').map(s => s && s.trim())
    for (const { h: state, i } of stateCols) {
      const cell = clean(row[i])
      if (!cell || cell === '-') continue
      const ready = cell.toUpperCase() === 'C'
      // UHC L&A doesn't split MA vs PDP — emit both with the same status.
      for (const product of ['MA', 'PDP']) {
        out.push({
          agent_npn:  npn,
          first_name: first || null,
          last_name:  last  || null,
          email:      null,
          carrier:    'UnitedHealthcare',
          plan_year:  2026,
          writing_number: npn,
          state,
          product_category: product,
          rts_status: ready ? 'Y' : 'N',
        })
      }
    }
  }
  return { appointments: out }
}
