// Alignment Health RTS report (Firm_Alignment_RTS_<timestamp>.csv).
// One row per rep × state (STATE2). Two status columns per row:
//   STATUS_CURRENT_YR — the plan year currently being sold
//   STATUS_AEP        — the upcoming AEP plan year (AEP_TRAIN_YR)
// 'A' = active/ready, 'I' = inactive.
//
// Plan years come from the FILE (AEP_TRAIN_YR and the year before it), not
// the Imports-page selector.
//   AEP year     RTS = STATUS_AEP is 'A'
//   current year RTS = STATUS_CURRENT_YR is 'A' OR STATUS_AEP is 'A'
// The AEP cert counts for the current year too: an agent certified for the
// upcoming year can sell now. (In NSBA's first year, 2026, Alignment never
// ran a 2026 cert, so the 2027 cert is what makes agents ready for 2026.)
import { readCsv, rowsToObjects, clean } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'alignment',
  label: 'Alignment RTS Report',
  accept: '.csv',
  target: 'carrier_appointments',
}

const REQUIRED = ['NPN_NUMBER', 'STATE2', 'STATUS_CURRENT_YR', 'STATUS_AEP', 'AEP_TRAIN_YR']

export async function parseFile(file, opts = {}) {
  const raw = await readCsv(file)
  if (!raw.length) return { appointments: [] }
  const headers = raw[0].map(h => String(h ?? '').trim())
  for (const req of REQUIRED) {
    if (!headers.includes(req)) {
      throw new Error(`Alignment RTS file is missing the ${req} column — nothing was imported.`)
    }
  }
  const rows = rowsToObjects(raw)
  const isActive = v => (clean(v) || '').toUpperCase() === 'A'

  const out = new Map()   // npn|year|state -> row ('Y' wins if a rep repeats)
  for (const r of rows) {
    const npn = clean(r['NPN_NUMBER'])
    if (!npn || !/^\d+$/.test(npn)) continue
    const state = toStateCode(r['STATE2'])
    if (!state) continue

    const aepYear = parseInt(clean(r['AEP_TRAIN_YR']), 10)
      || (opts.planYear ? opts.planYear + 1 : new Date().getFullYear() + 1)
    const currentYear = parseInt(clean(r['CURRENT_YR_TRAIN_YR']), 10) || aepYear - 1

    const aepReady = isActive(r['STATUS_AEP'])
    const currentReady = isActive(r['STATUS_CURRENT_YR']) || aepReady

    const base = {
      agent_npn: npn,
      first_name: clean(r['REP_FIRST_NAME']),
      last_name:  clean(r['REP_LAST_NAME']),
      email:      clean(r['REP_EMAIL'])?.toLowerCase() || null,
      carrier:    'Alignment',
      writing_number: npn,   // Sunfire uses the NPN as Alignment's writing number
      state,
      product_category: 'MA',
    }
    for (const [py, ready] of [[currentYear, currentReady], [aepYear, aepReady]]) {
      const k = `${npn}|${py}|${state}`
      if (out.get(k)?.rts_status === 'Y') continue
      out.set(k, { ...base, plan_year: py, rts_status: ready ? 'Y' : 'N' })
    }
  }
  return { appointments: [...out.values()] }
}
