// Shared helpers for the carrier release workflow.
import { KNOWN_CARRIERS } from './coverageModel.js'

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
