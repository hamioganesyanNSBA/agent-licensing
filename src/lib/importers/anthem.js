// Anthem / Elevance RTS report (CSV). Two formats are accepted, sniffed by
// header:
//
//  1. Current "<Firm>_Elevance_RTS_<timestamp>.csv" — see parseElevance()
//     below. Has NPNs and per-year RTS columns, so there's no name matching
//     and the Imports-page plan-year selector is ignored.
//  2. Legacy "Agent_Relationship_Report" hierarchy export — still used now and
//     then. Described here:
//
// This is an agency-hierarchy export that identifies
// agents by NAME only — there is no NPN column — so we resolve each writing
// agent to an NPN by matching D_Writing_Name against the agents table (the
// active Onyx roster). Columns (0-indexed): 0 A_State, 1 B_Market,
// 2 C_Writing_Etin, 3 D_Writing_Name, then paid/parent/hierarchy columns.
// Row 0 is the header; file uses \r\n endings, which readCsv normalizes.
//
// Rule: only rows whose H_Parent_Name (col H) is our current upline,
// INNOVATIVE FINANCIAL PARTNERS LLC, count as appointed (rts_status = Y) —
// every other upline (Premier Senior Marketing, Benefit Plans of America, …)
// is a leftover of an old hierarchy and is skipped entirely. The writing
// number (C_Writing_Etin) flows to the Sunfire export. The agency-level row
// (NATIONAL SENIOR BENEFIT ADVISORS) is skipped, and writing names under the
// current upline that don't resolve to an active agent are skipped and
// returned in `unmatched` (they're departed / non-Onyx agents).
// Skipped rows that DO resolve to an active roster agent are returned in
// `wrongUpline` (npn/name/uplines/states) so we can reach out and get their
// Anthem appointment moved under the current upline.
import { readCsv, rowsToObjects, clean } from '../parse.js'
import { toStateCode } from '../states.js'
import { fetchAll } from '../fetchAll.js'

export const meta = {
  key: 'anthem',
  label: 'Anthem (Elevance) RTS Report',
  accept: '.csv',
  target: 'carrier_appointments',
}

const AGENCY = 'NATIONAL SENIOR BENEFIT ADVISORS'
const CURRENT_UPLINE = 'INNOVATIVE FINANCIAL PARTNERS LLC'   // col H — only valid upline
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

export async function parseFile(file, opts = {}) {
  const rows = await readCsv(file)
  const hdr = (rows[0] || []).map(h => String(h ?? '').trim())
  if (hdr.includes('APPOINTMENTSTATE') && hdr.includes('PARENTNAME')) return parseElevance(rows, hdr)
  // Content fingerprint: the Anthem hierarchy export has lettered columns.
  if (hdr[0] !== 'A_State' || hdr[2] !== 'C_Writing_Etin') {
    throw new Error('This doesn\'t look like an Anthem RTS report — expected the Elevance RTS columns (APPOINTMENTSTATE / PARENTNAME) or the hierarchy export\'s A_State / C_Writing_Etin. Nothing was imported.')
  }
  const agents = await fetchAll('agents', 'npn,first_name,last_name')
  const idx = buildIndex(agents)
  const npnMap = new Map(agents.map(a => [a.npn, a]))

  const byConflict = new Map()   // dedupe on (npn, state) — carrier/year/product are constant
  const unmatched = new Map()
  const wrongUpline = new Map()  // npn -> roster agents parked under a non-current upline
  for (let i = 1; i < rows.length; i++) {   // row 0 = header
    const r = rows[i]
    const state   = toStateCode(r[0])   // A_State
    const writing = clean(r[2])         // C_Writing_Etin
    const name    = clean(r[3])         // D_Writing_Name
    if (!state || !writing || !name) continue
    if (name.toUpperCase() === AGENCY) continue
    const upline = norm(clean(r[7]))    // H_Parent_Name
    if (upline !== CURRENT_UPLINE) {
      // Not under our current upline — don't import, but flag active roster
      // agents so we can reach out and fix their appointment.
      const npn = resolveNpn(name, idx)
      if (npn) {
        const agent = npnMap.get(npn)
        const flag = wrongUpline.get(npn) || {
          npn,
          name: [agent?.first_name, agent?.last_name].filter(Boolean).join(' ') || name,
          uplines: new Set(),
          states: new Set(),
        }
        if (upline) flag.uplines.add(upline)
        flag.states.add(state)
        wrongUpline.set(npn, flag)
      }
      continue
    }
    const npn = resolveNpn(name, idx)
    if (!npn) { unmatched.set(name, (unmatched.get(name) || 0) + 1); continue }
    const agent = npnMap.get(npn)
    byConflict.set(`${npn}|${state}`, {
      agent_npn: npn,
      first_name: agent?.first_name || null,
      last_name:  agent?.last_name || null,
      email: null,
      carrier: 'Anthem',
      plan_year: opts.planYear || 2026,
      writing_number: writing,
      state,
      product_category: 'MA',
      rts_status: 'Y',
    })
  }
  return {
    appointments: [...byConflict.values()],
    unmatched: [...unmatched.keys()].sort(),
    wrongUpline: [...wrongUpline.values()]
      .map(f => ({ ...f, uplines: [...f.uplines].sort(), states: [...f.states].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// Elevance RTS report. One row per agent × APPOINTMENTSTATE × legal entity
// (LOB / LEGALENTITY — Anthem BCBS, Wellpoint, Healthy Blue, Simply, … all
// roll up to carrier 'Anthem', like the legacy report). Per plan year the file
// has HMO/PPO/PDP/SNP<year> cert flags, <year>RTS and <year>RTSMSONLY:
//   - Med-Supp-only entities have 'N/A' in all four product flags — skipped,
//     they say nothing about Medicare Advantage.
//   - <year>RTS is the MA readiness (<year>RTSMSONLY is the separate Med Supp
//     flag and is ignored). A state is RTS=Y for a year when ANY of its MA
//     entity rows says Yes.
// Every <year>RTS column emits a row. ENCRYPTEDTIN is the same value as the
// legacy report's C_Writing_Etin (WRITINGNUMBER is blank), so it's the writing
// number. Same upline rule as the legacy report: rows not under
// CURRENT_UPLINE are skipped and roster agents among them land in wrongUpline.
const MA_FLAGS = ['HMO', 'PPO', 'PDP', 'SNP']

async function parseElevance(raw, hdr) {
  const years = hdr.map(h => /^(\d{4})RTS$/.exec(h)).filter(Boolean).map(m => parseInt(m[1], 10))
  if (!hdr.includes('NPN') || !years.length) {
    throw new Error('Elevance RTS file is missing the NPN or <year>RTS columns — nothing was imported.')
  }
  const rows = rowsToObjects(raw)
  const isYes = v => (clean(v) || '').toUpperCase() === 'YES'

  const out = new Map()       // npn|year|state -> row ('Y' wins across entities)
  const offUpline = new Map() // npn -> flag, before the roster check
  for (const r of rows) {
    const npn = clean(r['NPN']) || clean(r['OneHQ_NPN'])
    if (!npn || !/^\d+$/.test(npn)) continue
    const state = toStateCode(r['APPOINTMENTSTATE'])
    if (!state) continue

    const upline = norm(clean(r['PARENTNAME']))
    if (upline !== CURRENT_UPLINE) {
      const flag = offUpline.get(npn)
        || { npn, name: clean(r['AGENTNAME']) || npn, uplines: new Set(), states: new Set() }
      if (upline) flag.uplines.add(upline)
      flag.states.add(state)
      offUpline.set(npn, flag)
      continue
    }

    for (const py of years) {
      const sellsMa = MA_FLAGS.some(f => {
        const v = (clean(r[f + py]) || '').toUpperCase()
        return v && v !== 'N/A'
      })
      if (!sellsMa) continue
      const k = `${npn}|${py}|${state}`
      if (out.get(k)?.rts_status === 'Y') continue
      out.set(k, {
        agent_npn: npn,
        first_name: clean(r['OneHQ_First_Name']) || clean(r['FIRSTNAME']),
        last_name:  clean(r['OneHQ_Last_Name'])  || clean(r['LASTNAME']),
        email:      clean(r['EMAIL'])?.toLowerCase() || null,
        carrier: 'Anthem',
        plan_year: py,
        writing_number: clean(r['ENCRYPTEDTIN']),
        state,
        product_category: 'MA',
        rts_status: isYes(r[py + 'RTS']) ? 'Y' : 'N',
      })
    }
  }

  // Only active roster agents are worth outreach — same as the legacy report.
  let wrongUpline = []
  if (offUpline.size) {
    const agents = await fetchAll('agents', 'npn,first_name,last_name')
    const npnMap = new Map(agents.map(a => [a.npn, a]))
    wrongUpline = [...offUpline.values()]
      .filter(f => npnMap.has(f.npn))
      .map(f => {
        const a = npnMap.get(f.npn)
        return {
          ...f,
          name: [a.first_name, a.last_name].filter(Boolean).join(' ') || f.name,
          uplines: [...f.uplines].sort(),
          states: [...f.states].sort(),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  return { appointments: [...out.values()], unmatched: [], wrongUpline }
}
