import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase.js'
import { fetchAll } from '../lib/fetchAll.js'
import { useIsEditor } from '../lib/useIsEditor.js'
import {
  SIRCON_URL, EXPIRING_WINDOW_DAYS, SKIP_REASONS, STATUS_BADGE,
  licenseKey, expiringLicenses, daysUntil, businessDaysSince, isStale,
  fmtTs, autoCompleteRenewals,
} from '../lib/renewals.js'

const OPEN_STATUSES = new Set(['selected', 'submitted', 'skipped'])

export default function RenewalDetail() {
  const { npn } = useParams()
  const { user } = useUser()
  const isEditor = useIsEditor()
  const [agent, setAgent] = useState(null)
  const [licenses, setLicenses] = useState([])
  const [renewals, setRenewals] = useState(null)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Selection state for the two action areas.
  const [pickKeys, setPickKeys] = useState(new Set())      // undecided licenses
  const [skipMode, setSkipMode] = useState(false)
  const [skipReason, setSkipReason] = useState('not_in_marketing')
  const [skipNotes, setSkipNotes] = useState('')
  const [submitIds, setSubmitIds] = useState(new Set())    // 'selected' rows to mark submitted
  const [confirmation, setConfirmation] = useState('')

  useEffect(() => { load() }, [npn])

  async function load() {
    const [a, l] = await Promise.all([
      supabase.from('agents').select('*').eq('npn', npn).maybeSingle(),
      fetchAll('licenses', '*', { eq: { npn } }),
    ])
    setAgent(a.data)
    setLicenses(l)
    try {
      await autoCompleteRenewals(npn)
      const { data, error } = await supabase.from('license_renewals')
        .select('*').eq('npn', npn).order('created_at', { ascending: false })
      if (error) throw error
      const rows = data || []
      setRenewals(rows)
      // Default the submit area to "everything selected".
      setSubmitIds(new Set(rows.filter(r => r.status === 'selected').map(r => r.id)))
    } catch (e) {
      if (/does not exist|42P01|schema cache|PGRST205/i.test(e.message || '')) setSetupNeeded(true)
      else setError(e.message || String(e))
      setRenewals([])
    }
  }

  const expiring = useMemo(() => expiringLicenses(licenses), [licenses])

  // A license already has a decision if an open row matches it, or a completed
  // row matches the exact same expiration cycle.
  const undecided = useMemo(() => {
    if (!renewals) return []
    return expiring.filter(lic => !renewals.some(r =>
      licenseKey(r) === licenseKey(lic)
      && (OPEN_STATUSES.has(r.status) || r.expiration_date === lic.expiration_date)))
  }, [expiring, renewals])

  const toSubmit  = useMemo(() => (renewals || []).filter(r => r.status === 'selected'), [renewals])
  const pending   = useMemo(() => (renewals || []).filter(r => r.status === 'submitted'), [renewals])
  const history   = useMemo(() => (renewals || [])
    .filter(r => r.status === 'completed' || r.status === 'skipped'), [renewals])

  function toggle(setSet, v) {
    setSet(prev => {
      const next = new Set(prev)
      next.has(v) ? next.delete(v) : next.add(v)
      return next
    })
  }

  async function saveDecision(decision) {
    const picked = undecided.filter(l => pickKeys.has(licenseKey(l)))
    if (!picked.length) return
    if (decision === 'skip' && skipReason === 'other' && !skipNotes.trim()) {
      setError('Notes are required when the reason is "Other".'); return
    }
    setBusy(true); setError('')
    try {
      const { error } = await supabase.from('license_renewals').insert(picked.map(l => ({
        npn,
        agent_name: agent ? `${agent.last_name}, ${agent.first_name}` : npn,
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
      setPickKeys(new Set()); setSkipMode(false); setSkipNotes('')
      await load()
    } catch (e) { setError(e.message || String(e)) }
    finally { setBusy(false) }
  }

  async function markSubmitted() {
    const ids = [...submitIds]
    if (!ids.length || !confirmation.trim()) return
    setBusy(true); setError('')
    try {
      const { error } = await supabase.from('license_renewals').update({
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

  async function undoRow(row) {
    setBusy(true); setError('')
    try {
      if (row.status === 'submitted') {
        // Back to "to renew" — clears the confirmation.
        const { error } = await supabase.from('license_renewals')
          .update({ status: 'selected', confirmation_number: null, submitted_at: null })
          .eq('id', row.id)
        if (error) throw error
      } else {
        // selected / skipped: remove the decision entirely.
        const { error } = await supabase.from('license_renewals').delete().eq('id', row.id)
        if (error) throw error
      }
      await load()
    } catch (e) { setError(e.message || String(e)) }
    finally { setBusy(false) }
  }

  if (setupNeeded) return (
    <>
      <h1>License Renewal</h1>
      <div className="card">
        <h2>One-time setup needed</h2>
        <p>The renewal table doesn&apos;t exist yet. Run <code>supabase/renewals.sql</code> in the
          Supabase SQL editor (Dashboard → SQL Editor → paste → Run), then reload this page.</p>
      </div>
    </>
  )

  if (!agent || !renewals) return <div><Link to="/renewals">← Renewals</Link><p>Loading…</p></div>

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
      <h1>License Renewal — {agent.first_name} {agent.last_name}</h1>
      <p style={{ color: '#64748b' }}>
        NPN {agent.npn} · <Link to={`/agents/${agent.npn}`}>agent profile</Link>
      </p>
      {error && <div className="card" style={{ color: '#991b1b' }}>Error: {error}</div>}

      {/* 1 · Decide */}
      <div className="card">
        <h2>1 · Expiring licenses — decide what to renew ({undecided.length})</h2>
        {undecided.length === 0 ? (
          <p style={{ color: '#64748b' }}>
            No undecided licenses expiring within {EXPIRING_WINDOW_DAYS} days.
          </p>
        ) : (
          <>
            <table>
              <thead><tr><th style={{ width: 30 }}>
                <input type="checkbox" style={{ width: 'auto' }}
                  checked={pickKeys.size === undecided.length}
                  onChange={e => setPickKeys(e.target.checked
                    ? new Set(undecided.map(licenseKey)) : new Set())} />
              </th><th>State</th><th>License #</th><th>LOAs</th><th>Expires</th></tr></thead>
              <tbody>
                {undecided.map(l => (
                  <tr key={licenseKey(l)}>
                    <td><input type="checkbox" style={{ width: 'auto' }}
                      checked={pickKeys.has(licenseKey(l))}
                      onChange={() => toggle(setPickKeys, licenseKey(l))} /></td>
                    <td>{l.state}</td>
                    <td>{l.license_number}</td>
                    <td style={{ fontSize: 12 }}>{l.loas.join(', ')}</td>
                    <td>{expBadge(l.expiration_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {isEditor && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                <button className="btn" disabled={busy || pickKeys.size === 0}
                  onClick={() => saveDecision('renew')}>
                  Renew selected ({pickKeys.size})
                </button>
                {!skipMode ? (
                  <button className="btn-secondary btn" disabled={busy || pickKeys.size === 0}
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
                    <button className="btn-danger btn" disabled={busy || pickKeys.size === 0}
                      onClick={() => saveDecision('skip')}>
                      Confirm don&apos;t renew ({pickKeys.size})
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
          <p style={{ color: '#64748b' }}>No licenses waiting to be submitted.</p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: '#64748b' }}>
              Apply for these renewals in Sircon, then enter the transaction confirmation
              number below — it moves the checked licenses to “Completed — pending sync”.
            </p>
            <table>
              <thead><tr><th style={{ width: 30 }}>
                <input type="checkbox" style={{ width: 'auto' }}
                  checked={submitIds.size === toSubmit.length}
                  onChange={e => setSubmitIds(e.target.checked
                    ? new Set(toSubmit.map(r => r.id)) : new Set())} />
              </th><th>State</th><th>License #</th><th>Expires</th><th /></tr></thead>
              <tbody>
                {toSubmit.map(r => (
                  <tr key={r.id}>
                    <td><input type="checkbox" style={{ width: 'auto' }}
                      checked={submitIds.has(r.id)}
                      onChange={() => toggle(setSubmitIds, r.id)} /></td>
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

      {/* 3 · Pending sync */}
      <div className="card">
        <h2>3 · Completed — pending Onyx sync ({pending.length})</h2>
        {pending.length === 0 ? (
          <p style={{ color: '#64748b' }}>Nothing waiting on the sync.</p>
        ) : (
          <table>
            <thead><tr><th>State</th><th>License #</th><th>Old expiration</th>
              <th>Confirmation #</th><th>Submitted</th><th>Waiting</th><th /></tr></thead>
            <tbody>
              {pending.map(r => {
                const days = businessDaysSince(r.submitted_at)
                return (
                  <tr key={r.id}>
                    <td>{r.state}</td>
                    <td>{r.license_number}</td>
                    <td>{r.expiration_date}</td>
                    <td>{r.confirmation_number}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtTs(r.submitted_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {days} business day{days === 1 ? '' : 's'}
                      {isStale(r) && (
                        <div className="badge badge-n" style={{ marginTop: 4 }}>
                          ⚠ No sync update — follow up in Sircon
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {isEditor && <button className="btn-secondary btn" disabled={busy}
                        onClick={() => undoRow(r)} style={{ padding: '4px 10px', fontSize: 12 }}>Undo</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="card">
          <h2>History ({history.length})</h2>
          <table>
            <thead><tr><th>State</th><th>License #</th><th>Expiration renewed</th>
              <th>Status</th><th>Reason</th><th>When</th><th /></tr></thead>
            <tbody>
              {history.map(r => {
                const [cls, label] = STATUS_BADGE[r.status] || ['badge-warn', r.status]
                return (
                  <tr key={r.id}>
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
