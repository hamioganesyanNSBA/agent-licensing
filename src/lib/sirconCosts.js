// Parsing + shared helpers for the Sircon licensing-cost tracker.
//
// Source files are Sircon's monthly "Billed Transactions" CSV exports. Two
// header variants exist: older files end at "Subscriber Rep Id"; newer ones
// add Username / First Name / Last Name / Email Address. Both parse the same.
// The SSN and EIN columns are read but never stored.
import { readCsv, rowsToObjects, clean } from './parse.js'
import { toStateCode } from './states.js'

// Sircon dates are MM-DD-YYYY.
function toIsoDate(v) {
  const s = clean(v)
  if (!s) return null
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return null
}

const toFee = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Parse one Billed Transactions CSV into licensing_costs rows. */
export async function parseSirconCsv(file) {
  const raw = await readCsv(file)
  if (!raw.length) return []
  const header = raw[0].map(h => String(h ?? '').trim())
  if (!header.includes('Service Type Code') || !header.includes('Confirmation ID')) {
    throw new Error(`${file.name}: not a Sircon Billed Transactions export (missing expected columns).`)
  }
  const objs = rowsToObjects(raw)
  const out = []
  for (const r of objs) {
    const date = toIsoDate(r['Date'])
    if (!date) continue
    const individual = clean(r['Individual Producer Identification'])
    const firm = clean(r['Firm Producer Identification'])
    out.push({
      date,
      state: toStateCode(r['State Code']) || clean(r['State Code']),
      service_code: clean(r['Service Type Code']),
      service_desc: clean(r['Service Type Description']),
      npn: clean(r['National Producer Number']),
      producer_name: individual || firm || null,
      is_firm: !!firm || !!clean(r['EIN']),
      state_fee: toFee(r['State Fee Amount']),
      sircon_fee: toFee(r['SIRCON Fee Amount']),
      confirmation_id: clean(r['Confirmation ID']) || '',
      requested_by: clean(r['Email Address']) || clean(r['Username']),
      source_file: file.name,
    })
  }
  return out
}

export const fmtMoney = v =>
  (v ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** {from, to} ISO bounds (null = unbounded) for a named timeframe preset. */
export function presetRange(preset, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth()
  const pad = n => String(n).padStart(2, '0')
  const ymd = (yy, mm, dd) => `${yy}-${pad(mm + 1)}-${pad(dd)}`   // local, no UTC shift
  switch (preset) {
    case 'this_month': return { from: ymd(y, m, 1), to: null }
    case 'last_month': {
      const prev = new Date(y, m, 0)   // last day of previous month (local)
      return { from: ymd(prev.getFullYear(), prev.getMonth(), 1),
               to:   ymd(prev.getFullYear(), prev.getMonth(), prev.getDate()) }
    }
    case 'this_year': return { from: `${y}-01-01`, to: null }
    case 'last_year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
    case 'last_12': {
      const d = new Date(today)
      d.setFullYear(d.getFullYear() - 1)
      return { from: ymd(d.getFullYear(), d.getMonth(), d.getDate()), to: null }
    }
    default: return { from: null, to: null }
  }
}

export const PRESETS = [
  ['all',        'All time'],
  ['this_month', 'This month'],
  ['last_month', 'Last month'],
  ['this_year',  'This year'],
  ['last_year',  'Last year'],
  ['last_12',    'Last 12 months'],
  ['custom',     'Custom range…'],
]
