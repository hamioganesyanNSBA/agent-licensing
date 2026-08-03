// Shared helpers for the license renewal workflow.
//
// Lifecycle of a license_renewals row (see supabase/renewals.sql):
//   decision 'renew': selected -> submitted (Sircon confirmation entered)
//                     -> completed (auto: Onyx sync shows a later expiration)
//   decision 'skip':  skipped (terminal, with a required reason)
// A 'submitted' row with no sync update after FOLLOW_UP_BUSINESS_DAYS is
// flagged for follow-up (derived at render time, not stored).
import { supabase } from './supabase.js'
import { fetchAll } from './fetchAll.js'

export const SIRCON_URL = 'https://www.sircon.com/login.jsp?accountType=business'
export const EXPIRING_WINDOW_DAYS = 90    // how far out a license counts as "expiring"
export const FOLLOW_UP_BUSINESS_DAYS = 7  // flag submitted renewals with no sync update after this

export const SKIP_REASONS = {
  not_in_marketing: 'Not in NSBA marketing',
  other: 'Other',
}

export const STATUS_BADGE = {
  selected:  ['badge-warn', 'To renew'],
  submitted: ['badge-warn', 'Completed — pending sync'],
  completed: ['badge-y',    'Renewed'],
  skipped:   ['badge-n',    'Not renewing'],
}

// Renewals track whole licenses (all LOAs together), not per-LOA rows.
export const licenseKey = r => `${r.npn}|${r.state}|${r.license_number || ''}`

export const todayIso = () => new Date().toISOString().slice(0, 10)

export function isoDaysFromNow(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysUntil(dateIso) {
  return Math.ceil((new Date(dateIso) - new Date(todayIso())) / 86400000)
}

/** Business days (weekends excluded) fully elapsed since a timestamp. */
export function businessDaysSince(ts, now = new Date()) {
  const d = new Date(ts)
  let n = 0
  while (true) {
    d.setDate(d.getDate() + 1)
    if (d > now) break
    const day = d.getDay()
    if (day !== 0 && day !== 6) n++
  }
  return n
}

/** Submitted, but the sync hasn't shown a new expiration for too long. */
export function isStale(row) {
  return row.status === 'submitted' && row.submitted_at
    && businessDaysSince(row.submitted_at) >= FOLLOW_UP_BUSINESS_DAYS
}

/**
 * Group Active license rows (per-LOA) into per-license entries expiring within
 * the window — already-expired licenses included, earliest LOA expiration wins.
 * Works for one agent's rows or the whole table (the key includes npn).
 */
export function expiringLicenses(licenseRows, windowDays = EXPIRING_WINDOW_DAYS) {
  const cutoff = isoDaysFromNow(windowDays)
  const byKey = new Map()
  for (const r of licenseRows) {
    if (r.status !== 'Active' || !r.expiration_date) continue
    const key = licenseKey(r)
    let e = byKey.get(key)
    if (!e) {
      e = { npn: r.npn, state: r.state, license_number: r.license_number,
            loas: new Set(), expiration_date: r.expiration_date }
      byKey.set(key, e)
    }
    if (r.loa) e.loas.add(r.loa)
    if (r.expiration_date < e.expiration_date) e.expiration_date = r.expiration_date
  }
  return [...byKey.values()]
    .filter(l => l.expiration_date <= cutoff)
    .map(l => ({ ...l, loas: [...l.loas].sort() }))
    .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date)
      || a.state.localeCompare(b.state))
}

export function fmtTs(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

// ---------- Agency (business-entity) license renewals ----------
// Same lifecycle, but agency licenses aren't in Onyx: completion is manual
// ("Mark renewed" writes the new expiration to agency_licenses), and the
// auto-complete below just notices expirations edited on the Agency page.

export const agencyLicenseKey = r => `${r.entity}|${r.state}|${r.license_number || ''}`

/** Active agency_licenses rows expiring within the window. */
export function expiringAgencyLicenses(rows, windowDays = EXPIRING_WINDOW_DAYS) {
  const cutoff = isoDaysFromNow(windowDays)
  return rows
    .filter(r => r.status === 'Active' && r.expiration_date && r.expiration_date <= cutoff)
    .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date)
      || a.entity.localeCompare(b.entity) || a.state.localeCompare(b.state))
}

/**
 * Close out submitted agency renewals whose license now shows a later
 * expiration (updated via "Mark renewed" or edited on the Agency page).
 * Defensive: returns 0 when either table doesn't exist yet.
 */
export async function autoCompleteAgencyRenewals() {
  const { data: rows, error } = await supabase.from('agency_license_renewals')
    .select('*').eq('status', 'submitted')
  if (error || !rows?.length) return 0
  let licenses
  try { licenses = await fetchAll('agency_licenses', 'id,entity,state,license_number,expiration_date') }
  catch { return 0 }
  const latest = new Map()
  for (const l of licenses) {
    const k = agencyLicenseKey(l)
    const exp = l.expiration_date || ''
    if (!latest.has(k) || exp > latest.get(k)) latest.set(k, exp)
  }
  const now = new Date().toISOString()
  let completed = 0
  for (const r of rows) {
    const cur = latest.get(agencyLicenseKey(r))
    if (!cur || cur <= r.expiration_date) continue
    const { error: uErr } = await supabase.from('agency_license_renewals')
      .update({ status: 'completed', completed_at: now }).eq('id', r.id)
    if (!uErr) completed++
  }
  return completed
}

/**
 * Close out submitted renewals once the Onyx sync shows a later expiration for
 * the license. Runs when renewal pages load. Defensive: returns 0 instead of
 * throwing when the license_renewals table doesn't exist yet.
 */
export async function autoCompleteRenewals(npn = null) {
  let q = supabase.from('license_renewals').select('*').eq('status', 'submitted')
  if (npn) q = q.eq('npn', npn)
  const { data: rows, error } = await q
  if (error || !rows?.length) return 0

  // Per-agent paginated fetches — same 1000-row-cap caution as elsewhere.
  const npns = [...new Set(rows.map(r => r.npn))]
  let licenses = []
  for (const n of npns) {
    licenses = licenses.concat(
      await fetchAll('licenses', 'npn,state,license_number,expiration_date', { eq: { npn: n } }))
  }
  const latest = new Map()   // license key -> newest expiration currently on file
  for (const l of licenses) {
    const k = licenseKey(l)
    const exp = l.expiration_date || ''
    if (!latest.has(k) || exp > latest.get(k)) latest.set(k, exp)
  }

  const now = new Date().toISOString()
  let completed = 0
  for (const r of rows) {
    const cur = latest.get(licenseKey(r))
    if (!cur || cur <= r.expiration_date) continue
    const { error: uErr } = await supabase.from('license_renewals')
      .update({ status: 'completed', completed_at: now }).eq('id', r.id)
    if (!uErr) completed++
  }
  return completed
}
