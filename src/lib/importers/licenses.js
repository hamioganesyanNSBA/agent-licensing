// Importer for the "All Licenses.csv" export.
// Row 1 is a title; row 2 is the header.
import { readCsv, rowsToObjects, toDate, clean } from '../parse.js'
import { toStateCode } from '../states.js'

export const meta = {
  key: 'licenses',
  label: 'Licenses (All Licenses.csv)',
  accept: '.csv',
  target: 'licenses',
}

export async function parseFile(file) {
  const rows = await readCsv(file)
  // Title row at 0, headers at 1.
  const objects = rowsToObjects(rows, 1)
  const licenses = []
  const agentsByNpn = new Map()
  for (const r of objects) {
    const npn = clean(r['NPN'])
    if (!npn) continue
    const name = clean(r['LICENSEE NAME'])
    licenses.push({
      licensee_name:   name,
      npn,
      state:           clean(r['STATE']),
      license_type:    clean(r['LICENSE TYPE']),
      license_number:  clean(r['LICENSE NUMBER']),
      loa:             clean(r['LINE OF AUTHORITY (LOA)']),
      issue_date:      toDate(r['ISSUE DATE']),
      expiration_date: toDate(r['EXPIRATION DATE']),
      // Two STATUS columns in the file — second one wins (status_date column).
      status:          clean(r['STATUS']),
      status_date:     toDate(r['STATUS DATE']),
      status_reason:   clean(r['STATUS REASON']),
    })
    if (name && !agentsByNpn.has(npn) && name !== 'NATIONAL SENIOR BENEFIT ADVISORS') {
      // Treat the file's "LICENSEE NAME" as "LAST FIRST" all-caps for individuals.
      const parts = name.split(/\s+/)
      agentsByNpn.set(npn, {
        npn,
        first_name: parts[0] || null,
        last_name:  parts.slice(1).join(' ') || null,
        email:      null,
      })
    }
  }
  return { licenses, agents: [...agentsByNpn.values()] }
}
