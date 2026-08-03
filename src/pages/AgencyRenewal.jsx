import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase.js'
import { fetchAll } from '../lib/fetchAll.js'
import { useIsEditor } from '../lib/useIsEditor.js'
import {
  SIRCON_URL, EXPIRING_WINDOW_DAYS, SKIP_REASONS, STATUS_BADGE,
  agencyLicenseKey, expiringAgencyLicenses, daysUntil, businessDaysSince,
  isStale, fmtTs, autoCompleteAgencyRenewals,
} from '../lib/renewals.js'

const OPEN_STATUSES = new Set(['selected', 'submitted', 'skipped'])

export default function AgencyRenewal() {
  const { user } = useUser()
  const isEditor = useIsEditor()
  const [licenses, setLicenses] = useState(null)
  const [renewals, setRenewals] = useState(null)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [pickIds, setPickIds] = useState(new Set())        // undecided agency_licenses ids
  const [skipMode, setSkipMode] = useState(false)
  const [skipReason, setSkipReason] = useState('not_in_marketing')
  const [skipNotes, setSkipNotes] = useState('')
  const [submitIds, setSubmitIds] = useState(new Set())    // 'selected' renewal ids
  const [confirmation, setConfirmation] = useState('')
  const [renewTarget, setRenewTarget] = useState(null)     // renewal id being marked renewed
  const [newExp, setNewExp] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const lics = await fetchAll('agency_licenses', '*')
      setLicenses(lics)
      await autoCompleteAgencyRenewals()
      const rows = await fetchAll('agency_license_renewals', '*')
      rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      setRenewals(rows)
      setSubmitIds(new Set(rows.filter(r => r.status === 'selected').map(r => r.id)))
    } catch (e) {
      if (/does not exist|42P01|schema cache|PGRST205/i.test(e.message || '')) setSetupNeeded(true)
      else setError(e.message || String(e))
      setLicenses(licenses || []); setRenewals([])
    }
  }

  const expiring = useMemo(
    () => expiringAgencyLicenses(licenses || []), [licenses])

  const undecided = useMemo(() => {
    if (!renewals) return []
    return expiring.filter(lic => !renewals.some(r =>
      agencyLicenseKey(r) === agencyLicenseKey(lic)
      && (OPEN_STATUSES.has(r.status) || r.expiration_date === lic.expiration_date)))
  }, [expiring, renewals])

  const toSubmit = useMemo(() => (renewals || []).filter(r => r.status === 'selected'), [renewals])
  const pending  = useMemo(() => (renewals || []).filter(r => r.status === 'submitted'), [renewals])
  const history  = useMemo(() => (renewals || [])
    .filter(r => r.status === 'completed' || r.status === 'skipped'), [renewals])

  function toggle(setSet, v) {
    setSet(prev => {
      const next = new Set(prev)
      next.has(v) ? next.delete(v) : next.add(v)
      return next
    })
  }

  async function saveDecision(decision) {
    const picked = undecided.filter(l => pickIds.has(l.id))
    if (!picked.length) return
    if (decision === 'skip' && skipReason === 'other' && !skipNotes.trim()) {
      setError('Notes are required when the reason is "Other".'); return
    }
    setBusy(true); setError('')
    try {
      const { error } = await supabase.from('agency_license_renewals').insert(picked.map(l => ({
        agency_license_id: l.id,
        entity: l.entity,
        state: l.state,
        license_number: l.license_number,
        expiration_date: l.expiration_date,
        decision,
        status: decision === 'renew' ? 'selected' : 'skipped',
        skip_reason: decision === 'skip' ? skipReason : null,
        skip_notes:  decision === 'skip' ? (skipNotes.trim() || null) : null,
        created_by: user?.primaryEmailAddress?.emailAddress || null,
      })))
      if (error) throw error
      setPickIds(new Set()); setSkipMode(false); setSkipNotes('')
      await load()
    } catch (e) { setError(e.message || String(e)) }
    finally { setBusy(false) }
  }

  async function markSubmitted() {
    const ids = [...submitIds]
    if (!ids.length || !confirmation.trim()) return
    setBusy(true); setError('')
    try {
      const { error } = await supabase.from('agency_license_renewals').update({
        status: 'submitted',
        confirmation_number: confirmation.trim(),
        submitted_at: new Date().toISOString(),
      }).in('id', ids)
      if (error) throw error
      setConfirmation('')
      await load()
    } catch (e) { setError(e.message || String(e)) }
    finally { setBusy(false) }
  }

  // Manual completion: write the new expiration onto the agency license itself,
  // then close the renewal. (Agency licenses aren't in Onyx — no sync to wait on.)
  async function markRenewed(row) {
    if (!newExp) return
    if (newExp <= row.expiration_date) {
      setError('The new expiration must be later than the old one.'); return
    }
    setBusy(true); setError('')
    try {
      const patch = { expiration_date: newExp, status: 'Active', updated_at: new Date().toISOString() }
      let q = supabase.from('agency_licenses').update(patch)
      if (row.agency_license_id) q = q.eq('id', row.agency_license_id)
      else {
        q = q.eq('entity', row.entity).eq('state', row.state)
        q = row.license_number ? q.eq('license_number', row.license_number) : q.is('license_number', null)
      }
      const { error: lErr } = await q
      if (lErr) throw lErr
      const { error } = await supabase.from('agency_license_renewals')
        .update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', row.id)
      if (error) throw error
      setRenewTarget(null); setNewExp('')
      await load()
    } catch (e) { setError(e.message || String(e)) }
    finally { setBusy(false) }
  }

  async function undoRow(row) {
    setBusy(true); setError('')
    try {
      if (row.status === 'submitted') {
        const { error } = await supabase.from('agency_license_renewals')
          .update({ status: 'selected', confirmation_number: null, submitted_at: null })
          .eq('id', row.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('agency_license_renewals').delete().eq('id', row.id)
        if (error) throw error
      }
      await load()
    } catch (e) { setError(e.message || String(e)) }
    finally { setBusy(false) }
  }

  if (setupNeeded) return (
    <>
      <h1>Agency License Renewal</h1>
      <div className="card">
        <h2>One-time setup needed</h2>
        <p>The renewal tables aren&apos;t fully set up. Re-run <code>supabase/renewals.sql</code> in the
          Supabase SQL editor (it&apos;s idempotent), then reload this page. The agency table from
          <code> supabase/agency.sql</code> must exist first.</p>
      </div>
    </>
  )

  if (!licenses || !renewals) return <div><Link to="/renewals">← Renewals</Link><p>Loading…</p></div>

  const expBadge = d => {
    const days = daysUntil(d)
    const color = days < 0 ? '#991b1b' : days <= 30 ? '#b45309' : '#64748b'
    return <span style={{ color, fontSize: 12 }}>
      {d} · {days < 0 ? `expired ${-days}d ago` : `${days}d left`}
    </span>
  }

  return (
    <>
      <Link to="/renewals">← Renewals</Link>
      <h1>Agency License Renewal</h1>
      <p style={{ color: '#64748b' }}>
        Business-entity licenses (<Link to="/agency">Agency Licenses</Link>). Not in Onyx —
        after Sircon approves, enter the new expiration here to complete the renewal.
      </p>
      {error && <div className="card" style={{ color: '#991b1b' }}>Error: {error}</div>}

      {/* 1 · Decide */}
      <div className="card">
        <h2>1 · Expiring agency licenses — decide what to renew ({undecided.length})</h2>
        {undecided.length === 0 ? (
          <p style={{ color: '#64748b' }}>
            No undecided agency licenses expiring within {EXPIRING_WINDOW_DAYS} days.
          </p>
        ) : (
          <>
            <table>
              <thead><tr><th style={{ width: 30 }}>
                <input type="checkbox" style={{ width: 'auto' }}
                  checked={pickIds.size === undecided.length}
                  onChange={e => setPickIds(e.target.checked
                    ? new Set(undecided.map(l => l.id)) : new Set())} />
              </th><th>Entity</th><th>State</th><th>License #</th><th>Type</th><th>Expires</th></tr></thead>
              <tbody>
                {undecided.map(l => (
                  <tr key={l.id}>
                    <td><input type="checkbox" style={{ width: 'auto' }}
                      checked={pickIds.has(l.id)}
                      onChange={() => toggle(setPickIds, l.id)} /></td>
                    <td style={{ fontWeight: 600 }}>{l.entity}</td>
                    <td>{l.state}</td>
                    <td>{l.license_number}</td>
                    <td style={{ fontSize: 12 }}>{l.license_type}</td>
                    <td>{expBadge(l.expiration_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {isEditor && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                <button className="btn" disabled={busy || pickIds.size === 0}
                  onClick={() => saveDecision('renew')}>
                  Renew selected ({pickIds.size})
                </button>
                {!skipMode ? (
                  <button className="btn-secondary btn" disabled={busy || pickIds.size === 0}
                    onClick={() => setSkipMode(true)}>
                    Don&apos;t renew selected…
                  </button>
                ) : (
                  <>
                    <select value={skipReason} onChange={e => setSkipReason(e.target.value)}>
                      {Object.entries(SKIP_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <input placeholder={skipReason === 'other' ? 'Notes (required)' : 'Notes (optional)'}
                      value={skipNotes} onChange={e => setSkipNotes(e.target.value)} style={{ width: 260 }} />
                    <button className="btn-danger btn" disabled={busy || pickIds.size === 0}
                      onClick={() => saveDecision('skip')}>
                      Confirm don&apos;t renew ({pickIds.size})
                    </button>
                    <button className="btn-secondary btn" onClick={() => setSkipMode(false)}>Cancel</button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 2 · Apply in Sircon */}
      <div className="card">
        <h2>2 · Apply in Sircon ({toSubmit.length})</h2>
        {toSubmit.length === 0 ? (
          <p style={{ color: '#64748b' }}>No agency licenses waiting to be submitted.</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: '#64748b' }}>
              Apply for these renewals in Sircon, then enter the transaction confirmation
              number below — it moves the checked licenses to “Completed — pending approval”.
            </p>
            <table>
              <thead><tr><th style={{ width: 30 }}>
                <input type="checkbox" style={{ width: 'auto' }}
                  checked={submitIds.size === toSubmit.length}
                  onChange={e => setSubmitIds(e.target.checked
                    ? new Set(toSubmit.map(r => r.id)) : new Set())} />
              </th><th>Entity</th><th>State</th><th>License #</th><th>Expires</th><th /></tr></thead>
              <tbody>
                {toSubmit.map(r => (
                  <tr key={r.id}>
                    <td><input type="checkbox" style={{ width: 'auto' }}
                      checked={submitIds.has(r.id)}
                      onChange={() => toggle(setSubmitIds, r.id)} /></td>
                    <td style={{ fontWeight: 600 }}>{r.entity}</td>
                    <td>{r.state}</td>
                    <td>{r.license_number}</td>
                    <td>{expBadge(r.expiration_date)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isEditor && <button className="btn-secondary btn" disabled={busy}
                        onClick={() => undoRow(r)} style={{ padding: '4px 10px', fontSize: 12 }}>Undo</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
              <a className="btn" href={SIRCON_URL} target="_blank" rel="noreferrer">
                Open Sircon ↗
              </a>
              {isEditor && (
                <>
                  <input placeholder="Sircon confirmation #" value={confirmation}
                    onChange={e => setConfirmation(e.target.value)} style={{ width: 220 }} />
                  <button className="btn" disabled={busy || submitIds.size === 0 || !confirmation.trim()}
                    onClick={markSubmitted}>
                    Mark submitted ({submitIds.size})
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* 3 · Pending approval — completed manually */}
      <div className="card">
        <h2>3 · Completed — pending approval ({pending.length})</h2>
        {pending.length === 0 ? (
          <p style={{ color: '#64748b' }}>Nothing waiting on approval.</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: '#64748b' }}>
              Agency licenses aren&apos;t synced from Onyx (yet) — once the state approves the
              renewal, click <strong>Mark renewed</strong> and enter the new expiration date.
              That updates the license on the Agency Licenses page and completes the renewal.
            </p>
            <table>
              <thead><tr><th>Entity</th><th>State</th><th>License #</th><th>Old expiration</th>
                <th>Confirmation #</th><th>Submitted</th><th>Waiting</th><th /></tr></thead>
              <tbody>
                {pending.map(r => {
                  const days = businessDaysSince(r.submitted_at)
                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.entity}</td>
                      <td>{r.state}</td>
                      <td>{r.license_number}</td>
                      <td>{r.expiration_date}</td>
                      <td>{r.confirmation_number}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtTs(r.submitted_at)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {days} business day{days === 1 ? '' : 's'}
                        {isStale(r) && (
                          <div className="badge badge-n" style={{ marginTop: 4 }}>
                            ⚠ Still pending — follow up in Sircon
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {isEditor && (renewTarget === r.id ? (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <input type="date" value={newExp} onChange={e => setNewExp(e.target.value)} />
                            <button className="btn" disabled={busy || !newExp}
                              onClick={() => markRenewed(r)} style={{ padding: '4px 10px', fontSize: 12 }}>Save</button>
                            <button className="btn-secondary btn" disabled={busy}
                              onClick={() => { setRenewTarget(null); setNewExp('') }}
                              style={{ padding: '4px 10px', fontSize: 12 }}>Cancel</button>
                          </span>
                        ) : (
                          <>
                            <button className="btn" disabled={busy}
                              onClick={() => { setRenewTarget(r.id); setNewExp('') }}
                              style={{ padding: '4px 10px', fontSize: 12, marginRight: 4 }}>Mark renewed</button>
                            <button className="btn-secondary btn" disabled={busy}
                              onClick={() => undoRow(r)} style={{ padding: '4px 10px', fontSize: 12 }}>Undo</button>
                          </>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="card">
          <h2>History ({history.length})</h2>
          <table>
            <thead><tr><th>Entity</th><th>State</th><th>License #</th><th>Expiration renewed</th>
              <th>Status</th><th>Reason</th><th>When</th><th /></tr></thead>
            <tbody>
              {history.map(r => {
                const [cls, label] = STATUS_BADGE[r.status] || ['badge-warn', r.status]
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.entity}</td>
                    <td>{r.state}</td>
                    <td>{r.license_number}</td>
                    <td>{r.expiration_date}</td>
                    <td><span className={`badge ${cls}`}>{label}</span></td>
                    <td style={{ fontSize: 12 }}>
                      {r.status === 'skipped' && (SKIP_REASONS[r.skip_reason] || r.skip_reason)}
                      {r.skip_notes && <div style={{ color: '#64748b' }}>{r.skip_notes}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtTs(r.completed_at || r.created_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isEditor && r.status === 'skipped' && (
                        <button className="btn-secondary btn" disabled={busy}
                          onClick={() => undoRow(r)} style={{ padding: '4px 10px', fontSize: 12 }}>Undo</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
