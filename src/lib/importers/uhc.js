// UHC Readiness Report (686773_EA_Ready_<date>.xlsx).
// Sheet "L&A": hierarchy levels, agent identity columns, then one column per
// state (2-letter code) with values 'C' (licensed + appointed) or N/HA/HL (not).
// Sheet "Certs": one row per agent (× Agent ID) × Product Year with
// agent-level "Ready To Sell" (col AA) and "Certified" (col AB) Yes/No flags.
//
// Plan years (when the Certs sheet is present they come from the FILE, not the
// Imports-page selector): one set of rows per Product Year (e.g. 2026, 2027).
// A state is RTS=Y for a year only when its L&A cell is 'C' AND the agent has a
// Certs row for that year with Ready To Sell = Yes and Certified = Yes. No such
// row → N in every state for that year.
// Without a Certs sheet (older files) the selector year is used, L&A only.
import { readWorkbook, sheetToRows, clean } from '../parse.js'

export const meta = {
  key: 'uhc',
  label: 'UnitedHealthcare Readiness Report',
  accept: '.xlsx,.xls',
  target: 'carrier_appointments',
}

const STATE_RE = /^[A-Z]{2}$/

// NPN -> Set of Product Years in which the agent is ready + certified, plus
// the list of Product Years present in the sheet.
function readCerts(ws) {
  const rows = sheetToRows(ws)
  if (!rows.length) return null
  const headers = rows[0].map(h => (clean(h) || '').toLowerCase())
  const idx = (name) => headers.indexOf(name.toLowerCase())
  const iNpn = idx('NIPR Number'), iYear = idx('Product Year')
  const iRts = idx('Ready To Sell'), iCert = idx('Certified')
  for (const [col, i] of [['NIPR Number', iNpn], ['Product Year', iYear], ['Ready To Sell', iRts], ['Certified', iCert]]) {
    if (i < 0) throw new Error(`UHC "Certs" sheet is missing the ${col} column — nothing was imported.`)
  }
  const isYes = v => (clean(v) || '').toUpperCase() === 'YES'
  const years = new Set()
  const ready = new Map()
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const npn = clean(row[iNpn])
    const year = parseInt(clean(row[iYear]), 10)
    if (!npn || !year) continue
    years.add(year)
    // An agent can have several Agent IDs (rows) per year — any qualifying row counts.
    if (isYes(row[iRts]) && isYes(row[iCert])) {
      if (!ready.has(npn)) ready.set(npn, new Set())
      ready.get(npn).add(year)
    }
  }
  return years.size ? { years: [...years].sort(), ready } : null
}

export async function parseFile(file, opts = {}) {
  const wb = await readWorkbook(file)
  const ws = wb.Sheets['L&A']
  if (!ws) throw new Error('UHC file missing "L&A" sheet')
  const certs = wb.Sheets['Certs'] ? readCerts(wb.Sheets['Certs']) : null

  const planYears = certs ? certs.years : [opts.planYear || 2026]

  const rows = sheetToRows(ws)
  const headers = rows[0].map(h => clean(h))
  const idx = (name) => headers.indexOf(name)
  const iName = idx('Agent Name')
  const iNpn  = idx('NIPR Number')
  const iAgentId = idx('Agent ID')   // col J — UHC's writing number for Sunfire
  const stateCols = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h && STATE_RE.test(h))

  const out = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const npn = clean(row[iNpn])
    if (!npn) continue
    const agentId = iAgentId >= 0 ? clean(row[iAgentId]) : null
    const name = clean(row[iName]) || ''
    const [last, first] = name.split(',').map(s => s && s.trim())
    for (const year of planYears) {
      const certified = !certs || !!certs.ready.get(npn)?.has(year)
      for (const { h: state, i } of stateCols) {
        const cell = clean(row[i])
        if (!cell || cell === '-') continue
        const ready = certified && cell.toUpperCase() === 'C'
        // UHC L&A doesn't split MA vs PDP — emit both with the same status.
        for (const product of ['MA', 'PDP']) {
          out.push({
            agent_npn:  npn,
            first_name: first || null,
            last_name:  last  || null,
            email:      null,
            carrier:    'UnitedHealthcare',
            plan_year:  year,
            writing_number: agentId || npn,
            state,
            product_category: product,
            rts_status: ready ? 'Y' : 'N',
          })
        }
      }
    }
  }
  return { appointments: out }
}
