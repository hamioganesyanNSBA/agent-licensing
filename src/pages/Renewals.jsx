import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchAll } from '../lib/fetchAll.js'
import {
  EXPIRING_WINDOW_DAYS, licenseKey, expiringLicenses,
  businessDaysSince, isStale, fmtTs, autoCompleteRenewals,
} from '../lib/renewals.js'

const OPEN_STATUSES = new Set(['selected', 'submitted', 'skipped'])

export default function Renewals() {
  const [licenses, setLicenses] = useState(null)
  const [agents, setAgents] = useState([])
  const [renewals, setRenewals] = useState(null)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const [l, a] = await Promise.all([
      fetchAll('licenses', 'npn,state,license_number,loa,status,expiration_date'),
      fetchAll('agents', 'npn,first_name,last_name'),
    ])
    setLicenses(l)
    setAgents(a)
    try {
      await autoCompleteRenewals()
      setRenewals(await fetchAll('license_renewals', '*'))
    } catch (e) {
      if (/does not exist|42P01|schema cache|PGRST205/i.test(e.message || '')) setSetupNeeded(true)
      else setError(e.message || String(e))
      setRenewals([])
    }
  }

  const model = useMemo(() => {
    if (!licenses || !renewals) return null
    const expiring = expiringLicenses(licenses)
    const nameByNpn = new Map(agents.map(a => [a.npn, `${a.last_name}, ${a.first_name}`]))

    const byAgent = new Map()
    const row = npn => {
      let r = byAgent.get(npn)
      if (!r) {
        r = { npn, name: nameByNpn.get(npn) || npn,
              undecided: 0, toRenew: 0, pendingSync: 0, flagged: 0, earliest: null }
        byAgent.set(npn, r)
      }
      return r
    }

    for (const lic of expiring) {
      const decided = renewals.some(r => licenseKey(r) === licenseKey(lic)
        && (OPEN_STATUSES.has(r.status) || r.expiration_date === lic.expiration_date))
      if (decided) continue
      const r = row(lic.npn)
      r.undecided++
      if (!r.earliest || lic.expiration_date < r.earliest) r.earliest = lic.expiration_date
    }
    const flaggedRows = []
    for (const rw of renewals) {
      if (rw.status === 'selected') row(rw.npn).toRenew++
      if (rw.status === 'submitted') {
        row(rw.npn).pendingSync++
        if (isStale(rw)) { row(rw.npn).flagged++; flaggedRows.push(rw) }
      }
    }

    const summary = [...byAgent.values()].sort((a, b) =>
      b.flagged - a.flagged || b.undecided - a.undecided
      || b.toRenew - a.toRenew || a.name.localeCompare(b.name))
    const totals = summary.reduce((t, r) => ({
      undecided: t.undecided + r.undecided,
      toRenew: t.toRenew + r.toRenew,
      pendingSync: t.pendingSync + r.pendingSync,
      flagged: t.flagged + r.flagged,
    }), { undecided: 0, toRenew: 0, pendingSync: 0, flagged: 0 })
    return { summary, totals, flaggedRows }
  }, [licenses, agents, renewals])

  if (setupNeeded) return (
    <>
      <h1>License Renewals</h1>
      <div className="card">
        <h2>One-time setup needed</h2>
        <p>The renewal table doesn&apos;t exist yet. Run <code>supabase/renewals.sql</code> in the
          Supabase SQL editor (Dashboard → SQL Editor → paste → Run), then reload this page.</p>
      </div>
    </>
  )

  if (!model) return <><h1>License Renewals</h1><div className="card">Loading…</div></>

  const { summary, totals, flaggedRows } = model
  const stat = (label, value, color) => (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
    </div>
  )

  return (
    <>
      <h1>License Renewals</h1>
      {error && <div className="card" style={{ color: '#991b1b' }}>Error: {error}</div>}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {stat('Needs decision', totals.undecided, 'var(--nsba-navy)')}
        {stat('To submit in Sircon', totals.toRenew, '#b45309')}
        {stat('Pending Onyx sync', totals.pendingSync, '#b45309')}
        {stat('Flagged — follow up', totals.flagged, '#991b1b')}
      </div>

      {flaggedRows.length > 0 && (
        <div className="card" style={{ borderColor: '#fca5a5' }}>
          <h2 style={{ color: '#991b1b' }}>⚠ Flagged — submitted, but no sync update after 7 business days</h2>
          <table>
            <thead><tr><th>Agent</th><th>State</th><th>License #</th>
              <th>Confirmation #</th><th>Submitted</th><th>Waiting</th><th /></tr></thead>
            <tbody>
              {flaggedRows.map(r => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link to={`/renewals/${r.npn}`}>{r.agent_name || r.npn}</Link>
                  </td>
                  <td>{r.state}</td>
                  <td>{r.license_number}</td>
                  <td>{r.confirmation_number}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTs(r.submitted_at)}</td>
                  <td>{businessDaysSince(r.submitted_at)} business days</td>
                  <td><Link to={`/renewals/${r.npn}`}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Agents with renewal work ({summary.length})</h2>
        <p style={{ fontSize: 13, color: '#64748b' }}>
          Licenses expiring within {EXPIRING_WINDOW_DAYS} days, grouped by agent.
          Open an agent to decide, submit in Sircon, and track the confirmation.
        </p>
        <table>
          <thead><tr><th>Agent</th><th>Needs decision</th><th>To submit</th>
            <th>Pending sync</th><th>Flagged</th><th>Earliest expiration</th><th /></tr></thead>
          <tbody>
            {summary.map(r => (
              <tr key={r.npn}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link to={`/renewals/${r.npn}`}>{r.name}</Link>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{r.npn}</div>
                </td>
                <td>{r.undecided || ''}</td>
                <td>{r.toRenew || ''}</td>
                <td>{r.pendingSync || ''}</td>
                <td>{r.flagged ? <span className="badge badge-n">{r.flagged}</span> : ''}</td>
                <td>{r.earliest || ''}</td>
                <td><Link to={`/renewals/${r.npn}`}>Renew now →</Link></td>
              </tr>
            ))}
            {summary.length === 0 && (
              <tr><td colSpan={7} style={{ color: '#64748b' }}>
                Nothing to renew — no licenses expiring within {EXPIRING_WINDOW_DAYS} days. 🎉
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
