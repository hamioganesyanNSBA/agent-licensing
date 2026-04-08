// Build the Sunfire NSBA_RTS_*.xlsx upload file from carrier_appointments.
// Output columns (exact order): Agent NPN, First Name, Last Name, Email,
//   Carrier, Plan Year, Agent Writing Number, States, Product Categories,
//   RTS Status, FMO
import * as XLSX from 'xlsx'

const COLUMNS = [
  'Agent NPN','First Name','Last Name','Email','Carrier','Plan Year',
  'Agent Writing Number','States','Product Categories','RTS Status','FMO',
]

// rows: appointment rows from Supabase. Groups into one row per
// agent × carrier × plan_year × writing_number × rts_status, with States
// and Product Categories as semicolon-joined lists.
export function buildSunfireRows(appointments, { fmo = '' } = {}) {
  const groups = new Map()
  for (const a of appointments) {
    const key = [
      a.agent_npn, a.carrier, a.plan_year, a.writing_number || '', a.rts_status || '',
    ].join('|')
    let g = groups.get(key)
    if (!g) {
      g = {
        agent_npn: a.agent_npn,
        first_name: a.first_name,
        last_name:  a.last_name,
        email:      a.email,
        carrier:    a.carrier,
        plan_year:  a.plan_year,
        writing_number: a.writing_number,
        rts_status: a.rts_status,
        states:     new Set(),
        products:   new Set(),
      }
      groups.set(key, g)
    }
    if (a.state)            g.states.add(a.state)
    if (a.product_category) g.products.add(a.product_category)
  }
  return [...groups.values()].map(g => ({
    'Agent NPN': g.agent_npn,
    'First Name': g.first_name,
    'Last Name':  g.last_name,
    'Email':      g.email,
    'Carrier':    g.carrier,
    'Plan Year':  g.plan_year,
    'Agent Writing Number': g.writing_number,
    'States':              [...g.states].sort().join('; '),
    'Product Categories':  [...g.products].sort().join('; '),
    'RTS Status': g.rts_status,
    'FMO':        fmo,
  }))
}

export function downloadSunfireXlsx(rows, filename) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}
