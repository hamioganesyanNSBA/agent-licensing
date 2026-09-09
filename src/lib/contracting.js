// Shared helpers for the carrier contracting-issues workflow.
import { KNOWN_CARRIERS } from './coverageModel.js'
import { supabase } from './supabase.js'

export const CONTRACTING_CARRIERS = [...KNOWN_CARRIERS, 'UnitedHealthOne']

export const REASONS = ['Compliance', 'Data mismatch', 'Background', 'Other']

// Status metadata. `open` statuses keep the case in the working queue; the
// exit statuses close it (and clear it from the default list).
export const STATUS = {
  pending:            { label: 'Pending',            badge: 'badge-warn', open: true },
  resubmitted:        { label: 'Resubmitted',        badge: 'badge-res',  open: true },
  approved:           { label: 'Approved',           badge: 'badge-y',    open: false },
  unable_to_contract: { label: 'Unable to contract', badge: 'badge-n',    open: false },
}
export const OPEN_STATUSES = Object.keys(STATUS).filter(k => STATUS[k].open)
export const isOpen = (issue) => !!STATUS[issue.status]?.open

// Which transitions are offered from each status.
export const TRANSITIONS = {
  pending:            ['resubmitted', 'approved', 'unable_to_contract'],
  resubmitted:        ['pending', 'approved', 'unable_to_contract'],
  approved:           ['pending'],
  unable_to_contract: ['pending'],
}

export function fmtTs(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

export function isSetupError(e) {
  return /does not exist|42P01|schema cache|PGRST205/i.test(e?.message || '')
}

/** Insert a note on a case. Returns the inserted row. */
export async function addNote(issueId, body, author, isSystem = false) {
  const { data, error } = await supabase.from('contracting_issue_notes')
    .insert({ issue_id: issueId, body, author: author || null, is_system: isSystem })
    .select('*').single()
  if (error) throw error
  await supabase.from('contracting_issues').update({ updated_at: data.created_at }).eq('id', issueId)
  return data
}

/**
 * Move a case to `status`, stamping the matching timestamp and logging a
 * system note (with the optional reason text appended). Returns the patch
 * applied to the issue row.
 */
export async function setStatus(issue, status, author, reasonText = '') {
  if (!STATUS[status]) throw new Error(`Unknown status ${status}`)
  const now = new Date().toISOString()
  const patch = { status, updated_at: now }
  if (status === 'resubmitted') patch.resubmitted_at = now
  if (STATUS[status].open) patch.closed_at = null
  else patch.closed_at = now
  const { error } = await supabase.from('contracting_issues').update(patch).eq('id', issue.id)
  if (error) throw error
  const from = STATUS[issue.status]?.label || issue.status
  const body = `Status changed: ${from} → ${STATUS[status].label}${reasonText ? ` — ${reasonText}` : ''}`
  await addNote(issue.id, body, author, true)
  return patch
}

/**
 * Create one case per carrier for an agent. Returns the inserted issue rows.
 * `initialNote`, when given, is posted on each case.
 */
export async function createCases({ agent, carriers, reason, reasonDetail, initialNote, author }) {
  const rows = carriers.map(carrier => ({
    agent_npn: agent.npn,
    agent_name: `${agent.last_name || ''}, ${agent.first_name || ''}`.replace(/^, |, $/g, '') || agent.npn,
    carrier,
    reason: reason || null,
    reason_detail: reasonDetail || null,
    created_by: author || null,
  }))
  const { data, error } = await supabase.from('contracting_issues').insert(rows).select('*')
  if (error) throw error
  const note = (initialNote || '').trim()
  if (note) for (const issue of data) await addNote(issue.id, note, author, false)
  return data
}
