// Aetna Broker Readiness / RTS report. Formats accepted:
//
//  1. Legacy XLSX "Broker Readiness Report" — sheet "DETAIL", one row per
//     producer × product × state for a single plan year (the Imports-page
//     selector supplies the year).
//  2. Current RTS report "<Firm>_Aetna_RTS_<timestamp>.csv" or ".xlsx" — same
//     columns plus SALES_YEAR, First_Name/Last_Name. It carries BOTH the
//     current and the upcoming plan year in one file, so plan years come from
//     SALES_YEAR and the selector is ignored. Headers are matched by
//     headerKey() and "NULL" cells are blank (see parse.js), so the CSV and
//     XLSX flavours parse identically.
//
// Readiness: RTS_EXP_REASON blank == ready (codes like TF01/TF02,TF03 =
// training, UF01 = upline, AF02 = appointment). As a safety net a row is
// never counted ready when a readiness flag (BACKG/LIC/APPT/UPLINE/PRINCIPAL)
// is 'F' — the file has a few all-'F' placeholder rows with no PRODUCT, no
// RTS_DATE and no reason code; those are skipped (no product to key on).
import { readTable, rowsToKeyedObjects, headerKey, cleanNull as val } from '../parse.js'
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

const COL = {
  npn:     'NPN',
  product: 'PRODUCT',
  state:   'SELLSTATE',
  reason:  'RTSEXPREASON',
  year:    'SALESYEAR',
  first:   'FIRSTNAME',
  last:    'LASTNAME',
  name:    'NAME',
  email:   'CONTEMAIL',
}
const FLAG_COLS = ['BACKGFLAG', 'LICFLAG', 'APPTFLAG', 'UPLINEFLAG', 'PRINCIPALFLAG']
const REQUIRED = [COL.npn, COL.product, COL.state, COL.reason]

export async function parseFile(file, opts = {}) {
  // Legacy workbook has the "DETAIL" sheet; the current RTS export is "Sheet1".
  const raw = await readTable(file, { sheet: 'DETAIL', label: 'Aetna' })
  if (!raw.length) return { appointments: [] }
  const headers = raw[0].map(headerKey)
  for (const req of REQUIRED) {
    if (!headers.includes(req)) {
      throw new Error(`Aetna file is missing the ${req} column — nothing was imported.`)
    }
  }
  const rows = rowsToKeyedObjects(raw)

  const out = new Map()   // npn|year|state|product -> row ('Y' wins on a repeat)
  for (const r of rows) {
    const npn = val(r[COL.npn])
    if (!npn) continue
    const state = toStateCode(val(r[COL.state]))
    if (!state) continue
    const rawProduct = val(r[COL.product])
    if (!rawProduct) continue
    const product = PRODUCT_MAP[rawProduct.toUpperCase()] || rawProduct

    // RTS rows carry their own plan year; legacy XLSX rows use the selector.
    const planYear = parseInt(val(r[COL.year]), 10) || opts.planYear || 2026

    // First/Last Name exist on the RTS report; fall back to "LAST, FIRST" NAME.
    let first = val(r[COL.first])
    let last  = val(r[COL.last])
    if (!first && !last) {
      const [l, f] = (val(r[COL.name]) || '').split(',').map(s => s && s.trim())
      first = f || null
      last  = l || null
    }

    const flagFailed = FLAG_COLS.some(c => (val(r[c]) || '').toUpperCase() === 'F')
    const ready = !val(r[COL.reason]) && !flagFailed

    const k = `${npn}|${planYear}|${state}|${product}`
    if (out.get(k)?.rts_status === 'Y') continue
    out.set(k, {
      agent_npn: npn,
      first_name: first || null,
      last_name:  last  || null,
      email:      val(r[COL.email])?.toLowerCase() || null,
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
