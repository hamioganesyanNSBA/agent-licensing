// Parsing helpers used by importers.
import * as XLSX from 'xlsx'

export async function readWorkbook(file) {
  const buf = await file.arrayBuffer()
  return XLSX.read(buf, { type: 'array', cellDates: true })
}

export function sheetToObjects(ws, opts = {}) {
  return XLSX.utils.sheet_to_json(ws, { defval: null, raw: false, ...opts })
}

export function sheetToRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false })
}

// Parse a CSV file (handles quoted commas, both \n and \r line endings).
export async function readCsv(file) {
  const text = await file.text()
  return parseCsv(text)
}

export function parseCsv(text) {
  // Normalize line endings.
  const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const rows = []
  let row = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = false
      } else cur += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(cur); cur = '' }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
      else cur += c
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row) }
  return rows.filter(r => r.some(v => v !== ''))
}

export function rowsToObjects(rows, headerIndex = 0) {
  const headers = rows[headerIndex].map(h => String(h ?? '').trim())
  return rows.slice(headerIndex + 1).map(r => {
    const o = {}
    headers.forEach((h, i) => { o[h] = r[i] ?? null })
    return o
  })
}

export function toDate(v) {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  // Excel serial?
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  if (!s) return null
  // mm/dd/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [_, mm, dd, yyyy] = m
    return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
  }
  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10)
  const d = new Date(s)
  return isNaN(d) ? null : d.toISOString().slice(0,10)
}

export function clean(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

export function splitNameLastFirst(name) {
  // "JOHNSON, JONATHAN" -> { first: 'JONATHAN', last: 'JOHNSON' }
  if (!name) return { first: null, last: null }
  const [last, first] = String(name).split(',').map(s => s && s.trim())
  return { first: first || null, last: last || null }
}

export function splitNameFirstLast(name) {
  // "Abdul Deeb" -> { first: 'Abdul', last: 'Deeb' }
  if (!name) return { first: null, last: null }
  const parts = String(name).trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

// ---- Carrier RTS exports: CSV or XLSX, header casing varies, "NULL" cells ----
//
// The carriers' "<Firm>_<Carrier>_RTS_<timestamp>" reports come as CSV (upper
// snake-case headers) or XLSX (single "Sheet1", title-case headers, literal
// "NULL" strings in blank cells). These helpers let one importer read both.

// Header key: upper-case alphanumerics only, so "SELL_STATE", "Sell State"
// and "sell_state" all collide on purpose.
export const headerKey = h => String(h ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// clean() that also treats a literal "NULL" as empty.
export function cleanNull(v) {
  const s = clean(v)
  return s && s.toUpperCase() === 'NULL' ? null : s
}

// Raw rows (array of arrays) from a CSV, or from a workbook's named sheet
// when present, else its first sheet. `label` is only used in error text.
export async function readTable(file, { sheet, label = 'This' } = {}) {
  const isCsv = /\.csv$/i.test(file.name || '') || /^text\/csv/i.test(file.type || '')
  if (isCsv) return readCsv(file)
  const wb = await readWorkbook(file)
  const ws = (sheet && wb.Sheets[sheet]) || wb.Sheets[wb.SheetNames[0]]
  if (!ws) throw new Error(`${label} workbook has no sheets — nothing was imported.`)
  return sheetToRows(ws)
}

// Row objects keyed by headerKey(header). When two headers collide (the XLSX
// exports carry both "npn" and "NPN"), the first non-empty value wins.
export function rowsToKeyedObjects(rows, headerIndex = 0) {
  const keys = rows[headerIndex].map(headerKey)
  return rows.slice(headerIndex + 1).map(r => {
    const o = {}
    keys.forEach((k, i) => {
      if (!k) return
      const v = r[i] ?? null
      if (o[k] == null || o[k] === '') o[k] = v
    })
    return o
  })
}
