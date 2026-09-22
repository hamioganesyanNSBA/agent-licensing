// Humana RTS report (<Firm>_Humana_RTS_<timestamp>.csv).
// Three rows per agent × licensed state (LIC_ST_CD), one per Humana contract:
//   CONTR_DESC_CODE 'Medicare'   — MA/PDP contract (certs + appointments filled in)
//   CONTR_DESC_CODE 'Medsup'     — Medicare Supplement (cert columns 'NA')
//   CONTR_DESC_CODE 'Individual' — individual/ancillary products
// RTS_<year> is evaluated PER CONTRACT ROW: the Medsup/Individual rows routinely
// say Yes while the same agent/state's Medicare row says No (uncertified, life
// license only, contract pending execution). Only the Medicare row describes
// Medicare Advantage readiness, so the other two are ignored.
//
// Plan years come from the FILE — every RTS_<year> column (currently RTS_2026
// and RTS_2027) emits a row — not the Imports-page selector.
import { readCsv, rowsToObjects, clean } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'humana',
  label: 'Humana RTS Report',
  accept: '.csv',
  target: 'carrier_appointments',
}

const REQUIRED = ['NPN', 'LIC_ST_CD', 'CONTR_DESC_CODE']

export async function parseFile(file) {
  const raw = await readCsv(file)
  if (!raw.length) return { appointments: [] }
  const headers = raw[0].map(h => String(h ?? '').trim())
  for (const req of REQUIRED) {
    if (!headers.includes(req)) {
      throw new Error(`Humana RTS file is missing the ${req} column — nothing was imported.`)
    }
  }
  const yearCols = headers
    .map(h => [h, /^RTS_(\d{4})$/.exec(h)])
    .filter(([, m]) => m)
    .map(([h, m]) => [h, parseInt(m[1], 10)])
  if (!yearCols.length) {
    throw new Error('Humana RTS file has no RTS_<year> columns — nothing was imported.')
  }
  const rows = rowsToObjects(raw)
  const isYes = v => (clean(v) || '').toUpperCase() === 'YES'

  const out = new Map()   // npn|year|state -> row ('Y' wins if a rep repeats)
  for (const r of rows) {
    if ((clean(r['CONTR_DESC_CODE']) || '').toUpperCase() !== 'MEDICARE') continue
    const npn = clean(r['NPN'])
    if (!npn || !/^\d+$/.test(npn)) continue
    const state = toStateCode(r['LIC_ST_CD'])
    if (!state) continue

    const base = {
      agent_npn: npn,
      first_name: clean(r['First_Name']),
      last_name:  clean(r['Last_Name']),
      email:      clean(r['AGENTEMAIL'])?.toLowerCase() || null,
      carrier:    'Humana',
      writing_number: clean(r['AGENT_SAN']),   // Humana SAN (the Sunfire export sends the NPN)
      state,
      product_category: 'MA',
    }
    for (const [col, py] of yearCols) {
      const k = `${npn}|${py}|${state}`
      if (out.get(k)?.rts_status === 'Y') continue
      out.set(k, { ...base, plan_year: py, rts_status: isYes(r[col]) ? 'Y' : 'N' })
    }
  }
  return { appointments: [...out.values()] }
}
