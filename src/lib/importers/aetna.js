// Aetna Broker Readiness / RTS report. Formats accepted:
//
//  1. Legacy XLSX "Broker Readiness Report" — sheet "DETAIL", one row per
//     producer × product × state for a single plan year (the Imports-page
//     selector supplies the year).
//  2. Current RTS report "<Firm>_Aetna_RTS_<timestamp>.csv" or ".xlsx" — same
//     columns plus SALES_YEAR, First_Name/Last_Name. It carries BOTH the
//     current and the upcoming plan year in one file, so plan years come from
//     SALES_YEAR and the selector is ignored. The XLSX flavour has a single
//     "Sheet1", header casing/punctuation that differs from the CSV
//     ("npn", "sales_year", "First Name"), and literal "NULL" strings in
//     blank cells — headers are matched after stripping case/punctuation and
//     "NULL" is treated as blank so both flavours parse identically.
//
// Readiness: RTS_EXP_REASON blank == ready (codes like TF01/TF02,TF03 =
// training, UF01 = upline, AF02 = appointment). As a safety net a row is
// never counted ready when a readiness flag (BACKG/LIC/APPT/UPLINE/PRINCIPAL)
// is 'F' — the file has a few all-'F' placeholder rows with no PRODUCT, no
// RTS_DATE and no reason code; those are skipped (no product to key on).
import { readWorkbook, sheetToRows, readCsv, clean } from '../parse.js'
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

// Header keys after normalization (upper-case, alphanumerics only), so
// "SELL_STATE", "Sell State" and "sell_state" all resolve to the same column.
const norm = h => String(h ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
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

// clean() that also treats the XLSX export's literal "NULL" as empty.
const val = v => {
  const s = clean(v)
  return s && s.toUpperCase() === 'NULL' ? null : s
}

export async function parseFile(file, opts = {}) {
  const rows = await readRows(file)

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

// Returns row objects keyed by normalized header. CSV: the one table. XLSX:
// the legacy "DETAIL" sheet when present, otherwise the first sheet (the
// current RTS export is a single "Sheet1").
async function readRows(file) {
  const isCsv = /\.csv$/i.test(file.name || '') || /^text\/csv/i.test(file.type || '')
  let raw
  if (isCsv) {
    raw = await readCsv(file)
  } else {
    const wb = await readWorkbook(file)
    const ws = wb.Sheets['DETAIL'] || wb.Sheets[wb.SheetNames[0]]
    if (!ws) throw new Error('Aetna workbook has no sheets — nothing was imported.')
    raw = sheetToRows(ws)
  }
  if (!raw.length) return []

  const headers = raw[0].map(norm)
  for (const req of REQUIRED) {
    if (!headers.includes(req)) {
      throw new Error(`Aetna file is missing the ${req} column — nothing was imported.`)
    }
  }
  return raw.slice(1).map(r => {
    const o = {}
    headers.forEach((h, i) => { if (h) o[h] = r[i] ?? null })
    return o
  })
}
