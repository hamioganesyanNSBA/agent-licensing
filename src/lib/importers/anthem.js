// Anthem RTS report (CSV). This is an agency-hierarchy export that identifies
// agents by NAME only — there is no NPN column — so we resolve each writing
// agent to an NPN by matching D_Writing_Name against the agents table (the
// active Onyx roster). Columns (0-indexed): 0 A_State, 1 B_Market,
// 2 C_Writing_Etin, 3 D_Writing_Name, then paid/parent/hierarchy columns.
// Row 0 is the header; file uses \r\n endings, which readCsv normalizes.
//
// Rule: any row with a state (col A) and a writing number (col C) counts as
// appointed (rts_status = Y). The writing number (C_Writing_Etin) flows to the
// Sunfire export. The agency-level row (NATIONAL SENIOR BENEFIT ADVISORS) is
// skipped, and writing names that don't resolve to an active agent are skipped
// and returned in `unmatched` (they're departed / non-Onyx agents).
import { readCsv, clean } from '../parse.js'
import { toStateCode } from '../states.js'
import { fetchAll } from '../fetchAll.js'

export const meta = {
  key: 'anthem',
  label: 'Anthem RTS Report',
  accept: '.csv',
  target: 'carrier_appointments',
}

const AGENCY = 'NATIONAL SENIOR BENEFIT ADVISORS'
const SUFFIX = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V'])
const norm = s => (s || '').toUpperCase().replace(/[.,'’]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
const tokens = s => norm(s).split(' ').filter(t => t && !SUFFIX.has(t))

// Build name lookups from the agent roster. Primary key is firstToken|lastToken
// (also firstToken|lastNameJoined for compound last names); fallback is a unique
// last name, which catches nicknames (e.g. Anthem "RIGOBERTO UMANZOR" -> the one
// active "Umanzor").
function buildIndex(agents) {
  const byKey = new Map(), byLast = new Map()
  for (const a of agents) {
    const ft = tokens(a.first_name), lt = tokens(a.last_name)
    if (!ft.length || !lt.length) continue
    const last = lt[lt.length - 1], lastJoined = lt.join('')
    byKey.set(ft[0] + '|' + last, a.npn)
    byKey.set(ft[0] + '|' + lastJoined, a.npn)
    for (const k of new Set([last, lastJoined])) {
      if (!byLast.has(k)) byLast.set(k, new Set())
      byLast.get(k).add(a.npn)
    }
  }
  return { byKey, byLast }
}

function resolveNpn(name, { byKey, byLast }) {
  const t = tokens(name)
  if (t.length < 2) return null
  const first = t[0], last = t[t.length - 1], lastTwo = t.slice(-2).join('')
  for (const k of [first + '|' + last, first + '|' + lastTwo]) if (byKey.has(k)) return byKey.get(k)
  for (const k of [last, lastTwo]) { const s = byLast.get(k); if (s && s.size === 1) return [...s][0] }
  return null
}

export async function parseFile(file) {
  const rows = await readCsv(file)
  const agents = await fetchAll('agents', 'npn,first_name,last_name')
  const idx = buildIndex(agents)
  const npnMap = new Map(agents.map(a => [a.npn, a]))

  const byConflict = new Map()   // dedupe on (npn, state) — carrier/year/product are constant
  const unmatched = new Map()
  for (let i = 1; i < rows.length; i++) {   // row 0 = header
    const r = rows[i]
    const state   = toStateCode(r[0])   // A_State
    const writing = clean(r[2])         // C_Writing_Etin
    const name    = clean(r[3])         // D_Writing_Name
    if (!state || !writing || !name) continue
    if (name.toUpperCase() === AGENCY) continue
    const npn = resolveNpn(name, idx)
    if (!npn) { unmatched.set(name, (unmatched.get(name) || 0) + 1); continue }
    const agent = npnMap.get(npn)
    byConflict.set(`${npn}|${state}`, {
      agent_npn: npn,
      first_name: agent?.first_name || null,
      last_name:  agent?.last_name || null,
      email: null,
      carrier: 'Anthem',
      plan_year: 2026,
      writing_number: writing,
      state,
      product_category: 'MA',
      rts_status: 'Y',
    })
  }
  return { appointments: [...byConflict.values()], unmatched: [...unmatched.keys()].sort() }
}
