import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { fetchAll } from '../lib/fetchAll.js'
import { useIsEditor } from '../lib/useIsEditor.js'
import {
  CONTRACTING_CARRIERS, REASONS, STATUS, isOpen, fmtTs, isSetupError, createCases,
} from '../lib/contracting.js'

export default function ContractingIssues() {
  const { user } = useUser()
  const isEditor = useIsEditor()
  const navigate = useNavigate()
  const author = user?.primaryEmailAddress?.emailAddress || null

  const [issues, setIssues] = useState(null)
  const [noteCounts, setNoteCounts] = useState(new Map())
  const [agents, setAgents] = useState([])
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')
  const [q, setQ] = useState('')

  // New-case form
  const [showForm, setShowForm] = useState(false)
  const [agentQuery, setAgentQuery] = useState('')
  const [agentNpn, setAgentNpn] = useState('')
  const [selCarriers, setSelCarriers] = useState(new Set())
  const [reason, setReason] = useState('')
  const [reasonDetail, setReasonDetail] = useState('')
  const [initialNote, setInitialNote] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    // Roster = agents on active Onyx seats (i.e. present in `licenses`).
    Promise.all([
      fetchAll('agents', 'npn,first_name,last_name'),
      fetchAll('licenses', 'npn'),
    ]).then(([ags, lics]) => {
      const licensed = new Set(lics.map(l => l.npn))
      setAgents(ags.filter(a => licensed.has(a.npn)).sort((a, b) =>
        `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)))
    }).catch(() => {})
    try {
      const [rows, notes] = await Promise.all([
        fetchAll('contracting_issues', '*'),
        fetchAll('contracting_issue_notes', 'issue_id,is_system'),
      ])
      const counts = new Map()
      for (const n of notes) if (!n.is_system) counts.set(n.issue_id, (counts.get(n.issue_id) || 0) + 1)
      setIssues(rows)
      setNoteCounts(counts)
    } catch (e) {
      if (isSetupError(e)) setSetupNeeded(true)
      else setError(e.message || String(e))
      setIssues([])
    }
  }

  const filteredAgents = useMemo(() => {
    const s = agentQuery.toLowerCase()
    return agents.filter(a =>
      !s || `${a.first_name} ${a.last_name}`.toLowerCase().includes(s) || (a.npn || '').includes(s))
  }, [agents, agentQuery])

  const openPairs = useMemo(() => new Set((issues || []).filter(isOpen).map(i => `${i.agent_npn}|${i.carrier}`)),
    [issues])

  function toggleCarrier(c) {
    setSelCarriers(prev => {
      const next = new Set(prev)
      next.has(c) ? next.delete(c) : next.add(c)
      return next
    })
  }

  async function create() {
    if (!agentNpn || selCarriers.size === 0) return
    setCreating(true); setError('')
    try {
      const agent = agents.find(a => a.npn === agentNpn)
      const created = await createCases({
        agent, carriers: [...selCarriers], reason, reasonDetail, initialNote, author,
      })
      if (created.length === 1) navigate(`/contracting/${created[0].id}`)
      else {
        setShowForm(false); setAgentNpn(''); setSelCarriers(new Set()); setReason(''); setReasonDetail(''); setInitialNote('')
        await load()
      }
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setCreating(false)
    }
  }

  if (setupNeeded) return (
    <>
      <h1>Contracting Issues</h1>
      <div className="card">
        <h2>One-time setup needed</h2>
        <p>The contracting tables don&apos;t exist yet. Run <code>supabase/contracting.sql</code> in the
          Supabase SQL editor (Dashboard → SQL Editor → paste → Run), then reload this page.</p>
      </div>
    </>
  )

  if (!issues) return <><h1>Contracting Issues</h1><div className="card">Loading…</div></>

  const visible = issues.filter(i =>
    statusFilter === 'all' ? true
    : statusFilter === 'open' ? isOpen(i)
    : i.status === statusFilter
  ).filter(i => {
    if (!q) return true
    const s = q.toLowerCase()
    return (i.agent_name || '').toLowerCase().includes(s) || (i.agent_npn || '').includes(s)
      || (i.carrier || '').toLowerCase().includes(s)
  }).sort((a, b) =>
    (isOpen(a) ? 0 : 1) - (isOpen(b) ? 0 : 1)
    || (a.agent_name || '').localeCompare(b.agent_name || '')
    || a.carrier.localeCompare(b.carrier))

  const openCount = issues.filter(isOpen).length
  const selectedHasOpen = agentNpn && [...selCarriers].some(c => openPairs.has(`${agentNpn}|${c}`))

  return (
    <>
      <h1>Contracting Issues</h1>
      <p style={{ color: '#64748b', marginTop: -8 }}>
        Agents whose initial carrier contracting was declined or stalled. Cases stay in the queue while
        <em> pending</em> or <em>resubmitted</em>; marking one <em>approved</em> or <em>unable to contract</em> clears it.
      </p>
      {error && <div className="card" style={{ color: '#991b1b' }}>Error: {error}</div>}

      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {isEditor && (
            <button className="btn" onClick={() => { setShowForm(f => !f); setError('') }}>
              {showForm ? 'Close' : 'Log a contracting issue'}
            </button>
          )}
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="open">Open ({openCount})</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            <option value="all">All</option>
          </select>
          <input placeholder="Search agent, NPN, or carrier…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 240 }} />
          <span style={{ color: '#64748b', fontSize: 13 }}>{visible.length} cases</span>
        </div>

        {showForm && isEditor && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
            <h2>1 · Agent</h2>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <input placeholder="Search agent…" value={agentQuery} onChange={e => setAgentQuery(e.target.value)} style={{ width: 220 }} />
              <select value={agentNpn} onChange={e => setAgentNpn(e.target.value)} style={{ minWidth: 260 }}>
                <option value="">— choose an agent —</option>
                {filteredAgents.map(a => (
                  <option key={a.npn} value={a.npn}>{a.last_name}, {a.first_name} — {a.npn}</option>
                ))}
              </select>
            </div>

            <h2>2 · Carrier(s) with the issue</h2>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
              {CONTRACTING_CARRIERS.map(c => (
                <label key={c} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={selCarriers.has(c)} onChange={() => toggleCarrier(c)} />
                  {c}
                </label>
              ))}
            </div>
            {selectedHasOpen && (
              <p style={{ color: '#92400e', fontSize: 13 }}>⚠ This agent already has an open case with one of the selected carriers — check the list below before creating another.</p>
            )}

            <h2>3 · Reason</h2>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <select value={reason} onChange={e => setReason(e.target.value)}>
                <option value="">— reason —</option>
                {REASONS.map(r => <option key={r}>{r}</option>)}
              </select>
              <input placeholder="Details (e.g. SSN mismatch on application, E&O lapsed…)" value={reasonDetail}
                onChange={e => setReasonDetail(e.target.value)} style={{ flex: 1, minWidth: 320 }} />
            </div>

            <h2>4 · First note (optional)</h2>
            <textarea value={initialNote} rows={3} onChange={e => setInitialNote(e.target.value)}
              style={{ width: '100%', padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, font: 'inherit', marginBottom: 12 }}
              placeholder="What the carrier said, who you spoke to, what's needed to resubmit…" />

            <button className="btn" disabled={!agentNpn || selCarriers.size === 0 || creating} onClick={create}>
              {creating ? 'Creating…' : `Open ${selCarriers.size} case${selCarriers.size === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Agent</th><th>Carrier</th><th>Reason</th><th>Status</th><th>Opened</th><th>Last activity</th><th>Notes</th><th /></tr></thead>
          <tbody>
            {visible.map(i => {
              const st = STATUS[i.status] || { label: i.status, badge: 'badge-warn' }
              return (
                <tr key={i.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link to={`/contracting/${i.id}`}>{i.agent_name}</Link>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{i.agent_npn}</div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{i.carrier}</td>
                  <td>
                    {i.reason || <span style={{ color: '#94a3b8' }}>—</span>}
                    {i.reason_detail && <div style={{ fontSize: 12, color: '#64748b' }}>{i.reason_detail}</div>}
                  </td>
                  <td><span className={`badge ${st.badge}`}>{st.label}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTs(i.opened_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTs(i.updated_at)}</td>
                  <td>{noteCounts.get(i.id) || 0}</td>
                  <td><Link to={`/contracting/${i.id}`}>Open →</Link></td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr><td colSpan={8} style={{ color: '#64748b' }}>
                {statusFilter === 'open' ? 'No open contracting issues. 🎉' : 'Nothing here.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
