// Aetna Broker Readiness Report — sheet "DETAIL".
// One row per producer × product × state. RTS = LIC_FLAG/APPT_FLAG/etc all 'P'
// AND a non-blank RTS_DATE (or no RTS_EXP_REASON). We treat RTS_EXP_REASON
// blank == ready.
import { readWorkbook, sheetToObjects, clean } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'aetna',
  label: 'Aetna Broker Readiness Report',
  accept: '.xlsx,.xls',
  target: 'carrier_appointments',
}

const PRODUCT_MAP = {
  PARTD: 'PDP',
  MAPD:  'MA',
  MA:    'MA',
  CSNP:  'CSNP',
  DSNP:  'DSNP',
}

export async function parseFile(file) {
  const wb = await readWorkbook(file)
  const ws = wb.Sheets['DETAIL']
  if (!ws) throw new Error('Aetna file missing "DETAIL" sheet')
  const rows = sheetToObjects(ws)
  const out = []
  for (const r of rows) {
    const npn = clean(r['NPN'])
    if (!npn) continue
    const state = toStateCode(r['SELL_STATE'])
    if (!state) continue
    const product = PRODUCT_MAP[clean(r['PRODUCT'])?.toUpperCase()] || clean(r['PRODUCT'])
    // "NAME" is "LAST, FIRST"
    const name = clean(r['NAME']) || ''
    const [last, first] = name.split(',').map(s => s && s.trim())
    const ready = !clean(r['RTS_EXP_REASON'])
    out.push({
      agent_npn: npn,
      first_name: first || null,
      last_name:  last  || null,
      email:      clean(r['CONT_EMAIL']),
      carrier:    'Aetna',
      plan_year:  2026,
      writing_number: clean(r['BROKER_ID']),
      state,
      product_category: product,
      rts_status: ready ? 'Y' : 'N',
    })
  }
  return { appointments: out }
}
