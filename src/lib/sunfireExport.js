// Build the Sunfire NSBA_RTS_*.xlsx upload file from carrier_appointments.
// Modeled on the "Sunfire Sample.xlsx" reference file:
//   - Columns (exact order): Agent NPN, First Name, Last Name, Email, Carrier,
//     Plan Year, Agent Writing Number, States, Product Categories, RTS Status, FMO
//   - One row per agent x carrier x plan year; States is a "; "-joined sorted list.
//   - Only ACTIVE agents (NPN present in the licenses table / Onyx roster).
//   - Only RTS=Y appointments: States lists only ready states, and agents with
//     no ready states for a carrier/year get no row at all.
//   - Product Categories is always the full set: "MA; PDP; CSNP; DSNP" — being
//     appointed in a state implies all products.
//   - Carrier names use Sunfire's display names (e.g. "Wellcare Health Plans").
//   - NPN / numeric writing numbers are written as numbers, like the sample.
import * as XLSX from 'xlsx'

const COLUMNS = [
  'Agent NPN','First Name','Last Name','Email','Carrier','Plan Year',
  'Agent Writing Number','States','Product Categories','RTS Status','FMO',
]

const ALL_PRODUCTS = 'MA; PDP; CSNP; DSNP'

// Our internal carrier values -> Sunfire display names (from the sample file).
const CARRIER_DISPLAY = {
  'Devoted':  'Devoted Health',
  'Wellcare': 'Wellcare Health Plans',
  'SCAN':     'SCAN Health Plan',
  'Zing':     'Zing Health',
}

const asNumberIfNumeric = v => (v != null && /^\d+$/.test(String(v)) ? Number(v) : (v ?? null))

/**
 * appointments: rows from carrier_appointments (all years).
 * agents:       rows from the agents table (npn, first_name, last_name, email) —
 *               the active Onyx roster; also the source of truth for emails.
 * activeNpns:   Set of NPNs considered active (NPNs present in licenses table).
 */
export function buildSunfireRows(appointments, agents, activeNpns, { fmo = null } = {}) {
  const agentByNpn = new Map(agents.map(a => [a.npn, a]))

  const groups = new Map()
  for (const a of appointments) {
    if (a.rts_status !== 'Y') continue                    // only ready states
    if (!activeNpns.has(a.agent_npn)) continue            // only active agents
    const key = `${a.agent_npn}|${a.carrier}|${a.plan_year}`
    let g = groups.get(key)
    if (!g) {
      const roster = agentByNpn.get(a.agent_npn)
      g = {
        agent_npn:  a.agent_npn,
        first_name: roster?.first_name || a.first_name,
        last_name:  roster?.last_name  || a.last_name,
        email:      roster?.email      || a.email || null,
        carrier:    CARRIER_DISPLAY[a.carrier] || a.carrier,
        plan_year:  a.plan_year,
        writing_numbers: new Map(),   // value -> count, to pick the most common
        states:     new Set(),
      }
      groups.set(key, g)
    }
    if (a.state) g.states.add(a.state)
    if (a.writing_number) {
      g.writing_numbers.set(a.writing_number, (g.writing_numbers.get(a.writing_number) || 0) + 1)
    }
  }

  const rows = [...groups.values()].map(g => {
    const writing = [...g.writing_numbers.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null
    return {
      'Agent NPN':   asNumberIfNumeric(g.agent_npn),
      'First Name':  g.first_name,
      'Last Name':   g.last_name,
      'Email':       g.email,
      'Carrier':     g.carrier,
      'Plan Year':   g.plan_year,
      'Agent Writing Number': asNumberIfNumeric(writing),
      'States':              [...g.states].sort().join('; '),
      'Product Categories':  ALL_PRODUCTS,
      'RTS Status': 'Y',
      'FMO':        fmo,
    }
  })

  // Sample ordering: agent, then carrier, then plan year.
  rows.sort((a, b) =>
    String(a['First Name'] || '').localeCompare(String(b['First Name'] || ''))
    || String(a['Last Name'] || '').localeCompare(String(b['Last Name'] || ''))
    || String(a['Carrier']).localeCompare(String(b['Carrier']))
    || a['Plan Year'] - b['Plan Year'])
  return rows
}

export function downloadSunfireXlsx(rows, filename) {
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}
