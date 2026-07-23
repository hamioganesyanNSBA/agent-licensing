// Shared helpers for the carrier release workflow.
import { KNOWN_CARRIERS } from './coverageModel.js'
import { supabase } from './supabase.js'

export const RELEASE_CARRIERS = KNOWN_CARRIERS   // all carriers we work with

// Progress = every trackable task in the workflow, done/total.
// Tasks: release letter (1), Aetna hierarchy form (1, only when Aetna is in
// the workflow), then Sent / Approved / RTS-confirmed per carrier (3 each).
export function computeProgress(wf, carriers) {
  const tasks = [!!wf.release_letter_uploaded_at]
  if (carriers.some(c => c.carrier === 'Aetna')) tasks.push(!!wf.aetna_hierarchy_uploaded_at)
  for (const c of carriers) tasks.push(!!c.sent_at, !!c.approved_at, !!c.rts_confirmed_at)
  const done = tasks.filter(Boolean).length
  return { done, total: tasks.length, pct: tasks.length ? done / tasks.length : 0 }
}

// A workflow is complete when the letter is in and every carrier is RTS-confirmed.
export function isComplete(wf, carriers) {
  return !!wf.release_letter_uploaded_at
    && carriers.length > 0
    && carriers.every(c => c.rts_confirmed_at)
}

export function fmtTs(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

// Auto-confirm the final step: for every open workflow (or just `workflowId`),
// any carrier that is contract-approved but not yet RTS-confirmed gets stamped
// automatically when our imported RTS reports (latest plan year) show the
// agent as rts_status = Y for that carrier. Runs after appointment imports and
// when release pages load. Defensive: returns zeros instead of throwing when
// the release tables don't exist yet.
export async function autoConfirmRts(workflowId = null) {
  let q = supabase.from('release_workflows')
    .select('id,agent_npn,release_letter_uploaded_at,status').eq('status', 'in_progress')
  if (workflowId) q = q.eq('id', workflowId)
  const { data: wfs, error: wErr } = await q
  if (wErr || !wfs?.length) return { confirmed: 0, completed: 0 }

  const { data: carriers, error: cErr } = await supabase.from('release_carriers')
    .select('*').in('workflow_id', wfs.map(w => w.id))
  if (cErr) return { confirmed: 0, completed: 0 }
  const eligible = (carriers || []).filter(c => c.approved_at && !c.rts_confirmed_at)
  if (!eligible.length) return { confirmed: 0, completed: 0 }

  const npns = [...new Set(wfs.map(w => w.agent_npn))]
  const { data: appts } = await supabase.from('carrier_appointments')
    .select('agent_npn,carrier,plan_year').eq('rts_status', 'Y').in('agent_npn', npns).limit(10000)
  const latest = Math.max(...(appts || []).map(a => a.plan_year || 0), 0)
  const rtsSet = new Set((appts || []).filter(a => a.plan_year === latest)
    .map(a => `${a.agent_npn}|${a.carrier}`))

  const wfById = new Map(wfs.map(w => [w.id, w]))
  const now = new Date().toISOString()
  let confirmed = 0
  for (const c of eligible) {
    const wf = wfById.get(c.workflow_id)
    if (!wf || !rtsSet.has(`${wf.agent_npn}|${c.carrier}`)) continue
    // Prefer marking the stamp as automatic; fall back gracefully if the
    // rts_confirmed_auto column hasn't been added yet.
    let { error } = await supabase.from('release_carriers')
      .update({ rts_confirmed_at: now, rts_confirmed_auto: true }).eq('id', c.id)
    if (error && /rts_confirmed_auto/.test(error.message || '')) {
      ({ error } = await supabase.from('release_carriers')
        .update({ rts_confirmed_at: now }).eq('id', c.id))
    }
    if (error) continue
    c.rts_confirmed_at = now; c.rts_confirmed_auto = true
    confirmed++
  }

  let completed = 0
  if (confirmed) {
    for (const wf of wfs) {
      const wcs = (carriers || []).filter(c => c.workflow_id === wf.id)
      if (isComplete(wf, wcs)) {
        await supabase.from('release_workflows')
          .update({ status: 'completed', completed_at: now }).eq('id', wf.id)
        completed++
      }
    }
  }
  return { confirmed, completed }
}
