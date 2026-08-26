// UHC eAlliance state-add requests: agents licensed in a state (active,
// unexpired, operating states only) where UHC's readiness data doesn't show
// them ready. The Coverage page turns these into the "eAlliance Bulk
// Non-Resident Appointments" form UHC requires for state adds.
//
// Duplicate protection: every download logs its (agent, state) pairs to
// uhc_state_requests (supabase/uhc_requests.sql). A pair requested within the
// last REQUEST_COOLDOWN_BUSINESS_DAYS is held out of new forms; once the
// cooldown passes, a still-missing state becomes requestable again.
import * as XLSX from 'xlsx'
import { supabase } from './supabase.js'
import { businessDaysSince } from './renewals.js'

export const REQUEST_COOLDOWN_BUSINESS_DAYS = 10

const UHC = 'UnitedHealthcare'

/**
 * Build the state-add plan from the coverage model plus the raw rows the
 * model was built from. Missing states come from the model's UHC cells, so
 * this always agrees with what the Coverage table displays.
 * Returns { rows, noWritingId, pendingPairs }:
 *   rows        — [{ npn, name, first, last, writing, email, request, pending }]
 *                 request/pending are state arrays; rows with request states
 *                 go on the form, pending ones are in cooldown.
 *   noWritingId — agents with missing states but no UHC writing ID at all
 *                 (need UHC contracting, not a state add).
 *   pendingPairs — total (agent, state) pairs currently in cooldown.
 */
export function buildUhcStateAddPlan(model, appointments, agents, requests, now = new Date()) {
  // Most-used UHC writing number per agent (any plan year — IDs don't change).
  const writingByNpn = new Map()
  for (const a of appointments) {
    if (a.carrier !== UHC || !a.writing_number) continue
    const counts = writingByNpn.get(a.agent_npn) || new Map()
    counts.set(a.writing_number, (counts.get(a.writing_number) || 0) + 1)
    writingByNpn.set(a.agent_npn, counts)
  }

  // (npn, state) pairs still inside the request cooldown.
  const inCooldown = new Set()
  for (const r of requests) {
    if (businessDaysSince(r.requested_at, now) < REQUEST_COOLDOWN_BUSINESS_DAYS) {
      inCooldown.add(`${r.agent_npn}|${r.state}`)
    }
  }

  const agentByNpn = new Map(agents.map(a => [a.npn, a]))
  const rows = [], noWritingId = []
  let pendingPairs = 0
  for (const row of model.rows) {
    const cell = row.cells.find(c => c.carrier === UHC)
    if (!cell || !cell.missing.length) continue
    const agent = agentByNpn.get(row.npn)
    const counts = writingByNpn.get(row.npn)
    if (!counts) {
      noWritingId.push({ npn: row.npn, name: row.name, missing: cell.missing })
      continue
    }
    const writing = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    const pending = cell.missing.filter(s => inCooldown.has(`${row.npn}|${s}`))
    const request = cell.missing.filter(s => !inCooldown.has(`${row.npn}|${s}`))
    pendingPairs += pending.length
    rows.push({
      npn: row.npn,
      name: row.name,
      first: (agent?.first_name || '').toUpperCase(),
      last: (agent?.last_name || '').toUpperCase(),
      writing,
      email: agent?.email || '',
      request,
      pending,
    })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return { rows, noWritingId, pendingPairs }
}

/** Rows that actually go on the form right now. */
export const requestableRows = plan => plan.rows.filter(r => r.request.length > 0)

/**
 * Generate and download the filled eAlliance form (same layout as UHC's
 * template: header on row 7, example on row 8, agents from row 9, columns
 * B–F). Returns the filename.
 */
export function downloadUhcForm(rows, now = new Date()) {
  const aoa = [
    [],
    [null, 'Non-Resident Appointment Request for National Senior Benefit Advisors'],
    [], [], [], [],
    [null, 'First Name \r\n(as indicated on license)', 'Last Name\r\n(as indicated on license)',
      'Writing ID', "Producer's Email Address", 'Non-Resident States'],
    ['Example', 'John', 'Smith', '123456', 'johnsmith@email.com', 'NY,PA', null, null,
      'Complete the spreadsheet and contact your dedicated team\r\nEmail: ealliancecontracting@uhc.com'],
    ...rows.map(r => [null, r.first, r.last, r.writing, r.email, r.request.join(',')]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 12 }, { wch: 34 }, { wch: 40 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Non-Resident Appointments')
  const d = `${now.getMonth() + 1}.${now.getDate()}.${String(now.getFullYear()).slice(2)}`
  const filename = `eAlliance Bulk Non-Resident Appointments_National Senior Benefit Advisors ${d}.xlsx`
  XLSX.writeFile(wb, filename)
  return filename
}

/** Log the downloaded pairs so they're suppressed for the cooldown window. */
export async function recordUhcRequests(rows, requestedBy) {
  const inserts = rows.flatMap(r => r.request.map(state => ({
    agent_npn: r.npn,
    state,
    writing_number: r.writing,
    requested_by: requestedBy || null,
  })))
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await supabase.from('uhc_state_requests').insert(inserts.slice(i, i + 500))
    if (error) throw error
  }
  return inserts.length
}
