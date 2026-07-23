import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase.js'
import { fetchAll } from '../lib/fetchAll.js'
import { RELEASE_CARRIERS, computeProgress, fmtTs, autoConfirmRts } from '../lib/releases.js'
import ProgressBar from '../components/ProgressBar.jsx'

const STATUS_BADGE = {
  in_progress: ['badge-warn', 'In progress'],
  completed:   ['badge-y', 'Completed'],
  cancelled:   ['badge-n', 'Cancelled'],
}

export default function Releases() {
  const { user } = useUser()
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState(null)
  const [carrierRows, setCarrierRows] = useState(null)
  const [agents, setAgents] = useState([])
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [statusFilter, setStatusFilter] = useState('open')

  // "Start a new release" form state
  const [showForm, setShowForm] = useState(false)
  const [agentQuery, setAgentQuery] = useState('')
  const [agentNpn, setAgentNpn] = useState('')
  const [selCarriers, setSelCarriers] = useState(new Set())
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    try {
      await autoConfirmRts()   // stamp any steps satisfied by freshly imported RTS data
      const [wfs, rcs, ags] = await Promise.all([
        fetchAll('release_workflows', '*'),
        fetchAll('release_carriers', '*'),
        fetchAll('agents', 'npn,first_name,last_name'),
      ])
      setWorkflows(wfs)
      setCarrierRows(rcs)
      setAgents(ags.sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`)))
    } catch (e) {
      if (/does not exist|42P01/i.test(e.message || '')) setSetupNeeded(true)
      else setError(e.message || String(e))
      setWorkflows([]); setCarrierRows([])
    }
  }

  const rows = useMemo(() => {
    if (!workflows || !carrierRows) return null
    const byWf = new Map()
    for (const c of carrierRows) {
      if (!byWf.has(c.workflow_id)) byWf.set(c.workflow_id, [])
      byWf.get(c.workflow_id).push(c)
    }
    return workflows.map(wf => {
      const carriers = byWf.get(wf.id) || []
      return { ...wf, carriers, progress: computeProgress(wf, carriers) }
    }).sort((a, b) =>
      (a.status === 'in_progress' ? 0 : 1) - (b.status === 'in_progress' ? 0 : 1)
      || new Date(b.created_at) - new Date(a.created_at))
  }, [workflows, carrierRows])

  const filteredAgents = useMemo(() => {
    const s = agentQuery.toLowerCase()
    return agents.filter(a =>
      !s || `${a.first_name} ${a.last_name}`.toLowerCase().includes(s) || (a.npn || '').includes(s))
  }, [agents, agentQuery])

  function toggleCarrier(c) {
    setSelCarriers(prev => {
      const next = new Set(prev)
      next.has(c) ? next.delete(c) : next.add(c)
      return next
    })
  }

  async function createWorkflow() {
    if (!agentNpn || selCarriers.size === 0) return
    setCreating(true); setError('')
    try {
      const agent = agents.find(a => a.npn === agentNpn)
      const { data, error } = await supabase.from('release_workflows').insert({
        agent_npn: agentNpn,
        agent_name: agent ? `${agent.last_name}, ${agent.first_name}` : agentNpn,
        created_by: user?.primaryEmailAddress?.emailAddress || null,
      }).select('id').single()
      if (error) throw error
      const { error: cErr } = await supabase.from('release_carriers')
        .insert([...selCarriers].map(carrier => ({ workflow_id: data.id, carrier })))
      if (cErr) throw cErr
      navigate(`/releases/${data.id}`)
    } catch (e) {
      setError(e.message || String(e))
      setCreating(false)
    }
  }

  if (setupNeeded) return (
    <>
      <h1>Releases</h1>
      <div className="card">
        <h2>One-time setup needed</h2>
        <p>The release tables don&apos;t exist yet. Run <code>supabase/releases.sql</code> in the
          Supabase SQL editor (Dashboard → SQL Editor → paste → Run), then reload this page.</p>
      </div>
    </>
  )

  if (!rows) return <><h1>Releases</h1><div className="card">Loading…</div></>

  const openNpns = new Set(rows.filter(r => r.status === 'in_progress').map(r => r.agent_npn))
  const visible = rows.filter(r =>
    statusFilter === 'all' ? true
    : statusFilter === 'open' ? r.status === 'in_progress'
    : r.status === statusFilter)

  return (
    <>
      <h1>Carrier Releases</h1>

      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn" onClick={() => { setShowForm(f => !f); setError('') }}>
            {showForm ? 'Close' : 'Start a new release workflow'}
          </button>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="open">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
          <span style={{ color: '#64748b', fontSize: 13 }}>{visible.length} workflows</span>
        </div>

        {showForm && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
            <h2>1 · Select the agent</h2>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <input placeholder="Search agent…" value={agentQuery} onChange={e => setAgentQuery(e.target.value)} style={{ width: 220 }} />
              <select value={agentNpn} onChange={e => setAgentNpn(e.target.value)} style={{ minWidth: 260 }}>
                <option value="">— choose an agent —</option>
                {filteredAgents.map(a => (
                  <option key={a.npn} value={a.npn}>{a.last_name}, {a.first_name} — {a.npn}</option>
                ))}
              </select>
            </div>
            {agentNpn && openNpns.has(agentNpn) && (
              <p style={{ color: '#92400e', fontSize: 13 }}>⚠ This agent already has a release in progress — check the list below before starting another.</p>
            )}

            <h2>2 · Select the carriers requiring release</h2>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
              <label style={{ fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" style={{ width: 'auto' }}
                  checked={selCarriers.size === RELEASE_CARRIERS.length}
                  onChange={e => setSelCarriers(e.target.checked ? new Set(RELEASE_CARRIERS) : new Set())} />
                Select all carriers
              </label>
              {RELEASE_CARRIERS.map(c => (
                <label key={c} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={selCarriers.has(c)} onChange={() => toggleCarrier(c)} />
                  {c}
                </label>
              ))}
            </div>

            <button className="btn" disabled={!agentNpn || selCarriers.size === 0 || creating} onClick={createWorkflow}>
              {creating ? 'Creating…' : `Create workflow (${selCarriers.size} carrier${selCarriers.size === 1 ? '' : 's'})`}
            </button>
            {error && <div style={{ color: '#991b1b', marginTop: 8 }}>Error: {error}</div>}
          </div>
        )}
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Agent</th><th>Carriers</th><th>Progress</th><th>Status</th><th>Started</th><th>Completed</th><th /></tr></thead>
          <tbody>
            {visible.map(r => {
              const [cls, label] = STATUS_BADGE[r.status] || ['badge-warn', r.status]
              return (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link to={`/releases/${r.id}`}>{r.agent_name}</Link>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{r.agent_npn}</div>
                  </td>
                  <td style={{ maxWidth: 260 }}>{r.carriers.map(c => c.carrier).join(', ')}</td>
                  <td style={{ minWidth: 180 }}>
                    <ProgressBar value={r.progress.pct} label={`${r.progress.done}/${r.progress.total}`} />
                  </td>
                  <td><span className={`badge ${cls}`}>{label}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTs(r.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTs(r.completed_at)}</td>
                  <td><Link to={`/releases/${r.id}`}>Open →</Link></td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr><td colSpan={7} style={{ color: '#64748b' }}>No release workflows here yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
