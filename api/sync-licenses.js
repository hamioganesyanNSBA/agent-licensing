// Vercel serverless function: pull agent licenses from Onyx and mirror them
// into Supabase `licenses` (+ `agents`). Triggered on demand by the "Sync from
// Onyx" button on the Imports page, and reusable by a Vercel Cron for automatic
// nightly syncs (point a cron at this same path).
//
// Secrets live in server-only env vars (NOT VITE_-prefixed, so never shipped to
// the browser):
//   ONYX_API_KEY        - required. Onyx external API key with "External Users".
//   ONYX_ORG            - optional. Defaults to the NSBA org slug.
//   ONYX_API_BASE       - optional. Defaults to https://api.onyxplatform.com.
//   SUPABASE_URL        - Supabase project URL (falls back to VITE_SUPABASE_URL).
//   SUPABASE_SERVICE_KEY- Supabase key for writes (falls back to the anon key).
import { createClient } from '@supabase/supabase-js'

export const config = { maxDuration: 60 }

const ONYX_BASE = process.env.ONYX_API_BASE || 'https://api.onyxplatform.com'
const ONYX_ORG  = process.env.ONYX_ORG || 'national-senior-benefit-advisors'
const ONYX_KEY  = process.env.ONYX_API_KEY

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY

const DETAIL_CONCURRENCY = 8   // ~128 agents / 8 = 16 batches, well under 300/min

async function onyxGet(path) {
  const res = await fetch(`${ONYX_BASE}${path}`, { headers: { 'X-API-Key': ONYX_KEY } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Onyx GET ${path} -> ${res.status} ${body.slice(0, 300)}`)
  }
  return res.json()
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Use GET or POST' })
  }
  // Vercel Cron invokes this via GET and (when CRON_SECRET is set) sends
  // `Authorization: Bearer <CRON_SECRET>`. If the secret is configured, require
  // it on GET so the scheduled endpoint can't be triggered by a random visitor.
  // The in-app button uses POST and is unaffected.
  if (req.method === 'GET' && process.env.CRON_SECRET
      && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (!ONYX_KEY)  return res.status(500).json({ error: 'ONYX_API_KEY is not configured' })
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase URL/key not configured' })
  }

  try {
    // 1) List every user in the org (page_size 1000 fits the whole roster).
    const users = []
    for (let page = 1; ; page++) {
      const data = await onyxGet(`/api/external/v1/users/${ONYX_ORG}?page=${page}&page_size=1000`)
      users.push(...(data.items || []))
      if (!data.has_next) break
    }

    // 2) Fetch per-user detail (licenses live only on the detail record).
    //    Only users with an NPN are agents. Per-user failures are non-fatal:
    //    we simply don't touch that agent's existing licenses.
    const agentUsers = users.filter(u => u.npn_number)
    const agentRows = []
    const licenseRows = []
    const syncedNpns = []
    let failed = 0

    for (const batch of chunk(agentUsers, DETAIL_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map(u => onyxGet(`/api/external/v1/users/${ONYX_ORG}/${u.user_id}`))
      )
      for (const r of settled) {
        if (r.status !== 'fulfilled') { failed++; continue }
        const d = r.value
        if (!d.npn_number) continue
        const name = [d.first_name, d.last_name].filter(Boolean).join(' ') || null
        syncedNpns.push(d.npn_number)
        agentRows.push({
          npn: d.npn_number,
          first_name: d.first_name || null,
          last_name:  d.last_name || null,
          email:      d.email || null,
        })
        for (const lic of (d.licenses || [])) {
          licenseRows.push({
            licensee_name:   name,
            npn:             d.npn_number,
            state:           lic.state_code,
            license_type:    null,                 // not exposed by the external API
            license_number:  lic.license_number,
            loa:             lic.line_of_insurance,
            issue_date:      null,
            expiration_date: lic.expiration_date || null,
            status:          lic.is_active ? 'Active' : 'Inactive',
            status_date:     null,
            status_reason:   null,
          })
        }
      }
    }

    // 3) Write to Supabase. Upsert agents; then mirror licenses for the agents
    //    we successfully pulled (delete-then-insert so dropped/expired licenses
    //    disappear instead of lingering). Only NPNs we got fresh data for are
    //    touched, so a partial Onyx failure never wipes good data.
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

    // Dedupe by conflict key — Onyx can return two user records sharing an NPN,
    // or repeat a (state, license_number, loa) combo. Postgres rejects duplicate
    // conflict keys within a single upsert/insert, so collapse them first.
    const agentMap = new Map()
    for (const a of agentRows) agentMap.set(a.npn, a)
    const dedupAgents = [...agentMap.values()]

    const licMap = new Map()
    for (const l of licenseRows) {
      licMap.set(`${l.npn}|${l.state}|${l.license_number}|${l.loa}`, l)
    }
    const dedupLicenses = [...licMap.values()]

    for (const c of chunk(dedupAgents, 500)) {
      const { error } = await supabase.from('agents').upsert(c, { onConflict: 'npn' })
      if (error) throw new Error(`agents upsert: ${error.message}`)
    }

    for (const npns of chunk([...new Set(syncedNpns)], 100)) {
      const { error } = await supabase.from('licenses').delete().in('npn', npns)
      if (error) throw new Error(`licenses delete: ${error.message}`)
    }

    for (const c of chunk(dedupLicenses, 500)) {
      const { error } = await supabase.from('licenses').insert(c)
      if (error) throw new Error(`licenses insert: ${error.message}`)
    }

    const imported_by = req.body?.imported_by || null
    await supabase.from('import_runs').insert({
      source: 'onyx',
      filename: null,
      row_count: dedupLicenses.length,
      imported_by,
      notes: `Onyx sync: ${dedupAgents.length} agents, ${dedupLicenses.length} licenses, ${failed} detail failures`,
    })

    return res.status(200).json({
      users: users.length,
      agents: dedupAgents.length,
      licenses: dedupLicenses.length,
      detail_failures: failed,
    })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message || String(e) })
  }
}
