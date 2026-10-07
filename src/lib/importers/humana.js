// Humana RTS report (<Firm>_Humana_RTS_<timestamp>.csv or .xlsx).
// Three rows per agent × licensed state (LIC_ST_CD), one per Humana contract:
//   CONTR_DESC_CODE 'Medicare'   — MA/PDP contract (certs + appointments filled in)
//   CONTR_DESC_CODE 'Medsup'     — Medicare Supplement (cert columns 'NA')
//   CONTR_DESC_CODE 'Individual' — individual/ancillary products
//   (the XLSX also has a handful of 'Achieve' rows — ignored like the others)
// RTS is evaluated PER CONTRACT ROW: the Medsup/Individual rows routinely say
// Yes while the same agent/state's Medicare row says No (uncertified, life
// license only, contract pending execution). Only the Medicare row describes
// Medicare Advantage readiness, so the other two are ignored.
//
// Plan years come from the FILE, not the Imports-page selector. Two layouts:
//   CSV:  one RTS_<year> column per plan year (RTS_2026, RTS_2027) — every
//         such column emits a row.
//   XLSX: Current_RTS + Current_RTS_Year (the AEP year, e.g. 2027) and
//         Previous_RTS (the year before) — verified against the CSV: the two
//         pairs line up exactly. The contract column is Contract_Desc_Code.
//         Some rows' Current_RTS_Year cells are date-formatted (2027 renders
//         as "7/19/05"), so a row whose year isn't a 4-digit number uses the
//         first valid year found in the file.
// Headers are matched by headerKey() and "NULL" cells are blank (parse.js).
import { readTable, rowsToKeyedObjects, headerKey, cleanNull as clean } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'humana',
  label: 'Humana RTS Report',
  accept: '.csv,.xlsx,.xls',
  target: 'carrier_appointments',
}

const REQUIRED = ['NPN', 'LICSTCD']
const CONTRACT_COLS = ['CONTRDESCCODE', 'CONTRACTDESCCODE']   // CSV / XLSX spelling

export async function parseFile(file) {
  const raw = await readTable(file, { label: 'Humana' })
  if (!raw.length) return { appointments: [] }
  const headers = raw[0].map(headerKey)
  for (const req of REQUIRED) {
    if (!headers.includes(req)) {
      throw new Error(`Humana RTS file is missing the ${req} column — nothing was imported.`)
    }
  }
  const contractCol = CONTRACT_COLS.find(c => headers.includes(c))
  if (!contractCol) {
    throw new Error('Humana RTS file is missing the CONTR_DESC_CODE column — nothing was imported.')
  }
  const yearCols = headers
    .map(h => [h, /^RTS(\d{4})$/.exec(h)])
    .filter(([, m]) => m)
    .map(([h, m]) => [h, parseInt(m[1], 10)])
  const perRowYears = headers.includes('CURRENTRTS') && headers.includes('CURRENTRTSYEAR')
  if (!yearCols.length && !perRowYears) {
    throw new Error('Humana RTS file has no RTS_<year> (or Current_RTS / Current_RTS_Year) columns — nothing was imported.')
  }
  const rows = rowsToKeyedObjects(raw)
  const isYes = v => (clean(v) || '').toUpperCase() === 'YES'
  const year4 = v => { const m = /^(\d{4})$/.exec(clean(v) || ''); return m ? parseInt(m[1], 10) : null }
  const fileYear = perRowYears ? rows.map(r => year4(r['CURRENTRTSYEAR'])).find(Boolean) : null
  if (perRowYears && !yearCols.length && !fileYear) {
    throw new Error('Humana RTS file has no readable Current_RTS_Year — nothing was imported.')
  }

  const out = new Map()   // npn|year|state -> row ('Y' wins if a rep repeats)
  for (const r of rows) {
    if ((clean(r[contractCol]) || '').toUpperCase() !== 'MEDICARE') continue
    const npn = clean(r['NPN'])
    if (!npn || !/^\d+$/.test(npn)) continue
    const state = toStateCode(clean(r['LICSTCD']))
    if (!state) continue

    // [plan year, RTS value] pairs for this row.
    let years
    if (yearCols.length) {
      years = yearCols.map(([col, py]) => [py, r[col]])
    } else {
      const cur = year4(r['CURRENTRTSYEAR']) || fileYear
      years = [[cur - 1, r['PREVIOUSRTS']], [cur, r['CURRENTRTS']]]
    }

    const base = {
      agent_npn: npn,
      first_name: clean(r['FIRSTNAME']),
      last_name:  clean(r['LASTNAME']),
      email:      clean(r['AGENTEMAIL'])?.toLowerCase() || null,
      carrier:    'Humana',
      writing_number: clean(r['AGENTSAN']),   // Humana SAN — this is what Sunfire wants, not the NPN
      state,
      product_category: 'MA',
    }
    for (const [py, v] of years) {
      const k = `${npn}|${py}|${state}`
      if (out.get(k)?.rts_status === 'Y') continue
      out.set(k, { ...base, plan_year: py, rts_status: isYes(v) ? 'Y' : 'N' })
    }
  }
  return { appointments: [...out.values()] }
}
