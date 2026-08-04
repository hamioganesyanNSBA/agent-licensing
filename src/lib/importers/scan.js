// SCAN RTS report. Two formats, sniffed by content:
//  - New (2026+) "Agency Downlines" export (AgencyDownlines_*.csv): one row
//    per broker, comma-packed STATES column, and per-plan-year training
//    flags. RTS = Active broker (no term date) + training Y for that plan
//    year. Emits rows for BOTH the selected plan year (CURR_YEAR_TRAINING)
//    and the next one (NEXT_YEAR_TRAINING).
//  - Legacy "ProStat" appointment report (shared with Cigna/Zing —
//    see _prostat.js).
import { parseProStat } from './_prostat.js'
import { parseCsv, clean } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'scan',
  label: 'SCAN RTS Report',
  accept: '.csv',
  target: 'carrier_appointments',
}

export async function parseFile(file, opts = {}) {
  const text = await file.text()
  if (/^FIRST_NAME,MIDDLE_NAME,LAST_NAME,NPN/i.test(text.trimStart())) {
    return parseDownlines(text, opts)
  }
  return parseProStat(file, 'SCAN', opts)
}

function parseDownlines(text, opts = {}) {
  // The export ships with the first data row glued onto the header line (no
  // newline after CONNECTIONS_TRAINING) — split them before parsing. The
  // regex only matches when the first quote follows unquoted header text, so
  // it's a no-op on a well-formed file.
  const fixed = text.replace(/^([^"\n]*)"/, '$1\n"')
  const rows = parseCsv(fixed)
  const headers = (rows[0] || []).map(h => String(h ?? '').trim())
  const col = Object.fromEntries(headers.map((h, i) => [h, i]))
  for (const req of ['NPN', 'STATES', 'BROKER_STATUS', 'CURR_YEAR_TRAINING', 'NEXT_YEAR_TRAINING']) {
    if (!(req in col)) {
      throw new Error(`SCAN Agency Downlines file is missing the ${req} column — nothing was imported.`)
    }
  }

  const year = opts.planYear || 2026
  const out = new Map()   // npn|year|state -> row ('Y' wins if a broker repeats)
  for (const r of rows.slice(1)) {
    const npn = clean(r[col.NPN])
    if (!npn || !/^\d+$/.test(npn)) continue
    const active = (clean(r[col.BROKER_STATUS]) || '').toLowerCase() === 'active'
      && !clean(r[col.TERM_DATE])
    const states = String(r[col.STATES] ?? '').split(',').map(toStateCode).filter(Boolean)
    const ready = {
      [year]:     active && (clean(r[col.CURR_YEAR_TRAINING]) || '').toUpperCase() === 'Y',
      [year + 1]: active && (clean(r[col.NEXT_YEAR_TRAINING]) || '').toUpperCase() === 'Y',
    }
    for (const state of states) {
      for (const py of [year, year + 1]) {
        const k = `${npn}|${py}|${state}`
        if (out.get(k)?.rts_status === 'Y') continue
        out.set(k, {
          agent_npn: npn,
          first_name: clean(r[col.FIRST_NAME]),
          last_name:  clean(r[col.LAST_NAME]),
          email:      null,
          carrier:    'SCAN',
          plan_year:  py,
          writing_number: npn,
          state,
          product_category: 'MA',
          rts_status: ready[py] ? 'Y' : 'N',
        })
      }
    }
  }
  return { appointments: [...out.values()] }
}
