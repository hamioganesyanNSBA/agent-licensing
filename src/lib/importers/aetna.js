// Aetna Broker Readiness / RTS report. Two formats are accepted:
//
//  1. Legacy XLSX "Broker Readiness Report" — sheet "DETAIL", one row per
//     producer × product × state for a single plan year (the Imports-page
//     selector supplies the year).
//  2. Current CSV "<Firm>_Aetna_RTS_<timestamp>.csv" — same columns plus
//     SALES_YEAR, First_Name/Last_Name. It carries BOTH the current and the
//     upcoming plan year in one file, so plan years come from SALES_YEAR and
//     the selector is ignored.
//
// Readiness: RTS_EXP_REASON blank == ready (codes like TF01/TF02,TF03 =
// training, UF01 = upline, AF02 = appointment). As a safety net a row is
// never counted ready when a readiness flag (BACKG/LIC/APPT/UPLINE/PRINCIPAL)
// is 'F' — the CSV has a few all-'F' placeholder rows with no PRODUCT, no
// RTS_DATE and no reason code; those are skipped (no product to key on).
import { readWorkbook, sheetToObjects, readCsv, rowsToObjects, clean } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'aetna',
  label: 'Aetna RTS / Broker Readiness Report',
  accept: '.csv,.xlsx,.xls',
  target: 'carrier_appointments',
}

const PRODUCT_MAP = {
  PARTD: 'PDP',
  MAPD:  'MA',
  MA:    'MA',
  CSNP:  'CSNP',
  DSNP:  'DSNP',
}

const FLAG_COLS = ['BACKG_FLAG', 'LIC_FLAG', 'APPT_FLAG', 'UPLINE_FLAG', 'PRINCIPAL_FLAG']
const CSV_REQUIRED = ['NPN', 'PRODUCT', 'SELL_STATE', 'RTS_EXP_REASON']

export async function parseFile(file, opts = {}) {
  const isCsv = /\.csv$/i.test(file.name || '') || /^text\/csv/i.test(file.type || '')
  const rows = isCsv ? await readCsvRows(file) : await readXlsxRows(file)

  const out = new Map()   // npn|year|state|product -> row ('Y' wins on a repeat)
  for (const r of rows) {
    const npn = clean(r['NPN'])
    if (!npn) continue
    const state = toStateCode(r['SELL_STATE'])
    if (!state) continue
    const rawProduct = clean(r['PRODUCT'])
    if (!rawProduct) continue
    const product = PRODUCT_MAP[rawProduct.toUpperCase()] || rawProduct

    // CSV rows carry their own plan year; XLSX rows use the selector.
    const planYear = parseInt(clean(r['SALES_YEAR']), 10) || opts.planYear || 2026

    // First_Name/Last_Name exist on the CSV; fall back to "LAST, FIRST" NAME.
    let first = clean(r['First_Name'])
    let last  = clean(r['Last_Name'])
    if (!first && !last) {
      const [l, f] = (clean(r['NAME']) || '').split(',').map(s => s && s.trim())
      first = f || null
      last  = l || null
    }

    const flagFailed = FLAG_COLS.some(c => (clean(r[c]) || '').toUpperCase() === 'F')
    const ready = !clean(r['RTS_EXP_REASON']) && !flagFailed

    const k = `${npn}|${planYear}|${state}|${product}`
    if (out.get(k)?.rts_status === 'Y') continue
    out.set(k, {
      agent_npn: npn,
      first_name: first || null,
      last_name:  last  || null,
      email:      clean(r['CONT_EMAIL'])?.toLowerCase() || null,
      carrier:    'Aetna',
      plan_year:  planYear,
      writing_number: npn,   // Sunfire uses the NPN as Aetna's writing number (not BROKER_ID)
      state,
      product_category: product,
      rts_status: ready ? 'Y' : 'N',
    })
  }
  return { appointments: [...out.values()] }
}

async function readXlsxRows(file) {
  const wb = await readWorkbook(file)
  const ws = wb.Sheets['DETAIL']
  if (!ws) throw new Error('Aetna file missing "DETAIL" sheet')
  return sheetToObjects(ws)
}

async function readCsvRows(file) {
  const raw = await readCsv(file)
  if (!raw.length) return []
  const headers = raw[0].map(h => String(h ?? '').trim())
  for (const req of CSV_REQUIRED) {
    if (!headers.includes(req)) {
      throw new Error(`Aetna RTS file is missing the ${req} column — nothing was imported.`)
    }
  }
  return rowsToObjects(raw)
}
