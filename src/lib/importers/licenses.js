// Importer for the "All Licenses.csv" export.
// Row 1 is a title; row 2 is the header.
// NOTE: The CSV has two columns named "STATUS" — column 7 is the license
// status (Active/Inactive) and column 10 is a separate status that can
// differ. We use index-based access to disambiguate.
import { readCsv, toDate, clean } from '../parse.js'

export const meta = {
  key: 'licenses',
  label: 'Licenses (All Licenses.csv)',
  accept: '.csv',
  target: 'licenses',
}

export async function parseFile(file) {
  const rows = await readCsv(file)
  // Row 0 = title, Row 1 = headers, Row 2+ = data
  // Headers: 0=LICENSEE NAME, 1=NPN, 2=STATE, 3=LICENSE TYPE,
  //          4=LICENSE NUMBER, 5=EXPIRATION DATE, 6=STATUS (license),
  //          7=LOA, 8=ISSUE DATE, 9=STATUS (secondary),
  //          10=STATUS DATE, 11=STATUS REASON
  const licenses = []
  const agentsByNpn = new Map()
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i]
    const npn = clean(r[1])
    if (!npn) continue
    const name = clean(r[0])
    licenses.push({
      licensee_name:   name,
      npn,
      state:           clean(r[2]),
      license_type:    clean(r[3]),
      license_number:  clean(r[4]),
      loa:             clean(r[7]),
      issue_date:      toDate(r[8]),
      expiration_date: toDate(r[5]),
      status:          clean(r[6]),   // Column 7: the real license status
      status_date:     toDate(r[10]),
      status_reason:   clean(r[11]),
    })
    if (name && !agentsByNpn.has(npn) && name !== 'NATIONAL SENIOR BENEFIT ADVISORS') {
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
