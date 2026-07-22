import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchAll } from '../lib/fetchAll.js'
import { buildCoverageModel, CARRIER_SHORT as SHORT } from '../lib/coverageModel.js'

// Carrier coverage tracking (model in lib/coverageModel.js): green = appointed
// in every sellable licensed state, amber = partial, red = no RTS appointments
// at all, grey = the carrier sells no plans in any of the agent's licensed
// states (not a gap).

export default function Coverage() {
  const [licenses, setLicenses] = useState(null)
  const [appointments, setAppointments] = useState(null)
  const [agents, setAgents] = useState(null)
  const [q, setQ] = useState('')
  const [gapsOnly, setGapsOnly] = useState(true)
  const [expanded, setExpanded] = useState(null)   // npn of the expanded row

  useEffect(() => {
    fetchAll('licenses', 'npn,state,status,expiration_date').then(setLicenses)
    fetchAll('carrier_appointments', 'agent_npn,carrier,plan_year,state,rts_status').then(setAppointments)
    fetchAll('agents', 'npn,first_name,last_name').then(setAgents)
  }, [])

  const model = useMemo(() => {
    if (!licenses || !appointments || !agents) return null
    return buildCoverageModel(licenses, appointments, agents)
  }, [licenses, appointments, agents])

  if (!model) return <><h1>Coverage</h1><div className="card">Loading…</div></>

  const filtered = model.rows.filter(r => {
    if (gapsOnly && r.gapCount === 0) return false
    if (!q) return true
    const s = q.toLowerCase()
    return r.name.toLowerCase().includes(s) || r.npn.includes(s)
  })

  const cellStyle = (level) => ({
    textAlign: 'center', cursor: 'pointer', fontWeight: 600, fontSize: 13,
    background: level === 'full' ? '#dcfce7' : level === 'partial' ? '#fef3c7' : level === 'none' ? '#fee2e2' : '#f1f5f9',
    color:      level === 'full' ? '#166534' : level === 'partial' ? '#92400e' : level === 'none' ? '#991b1b' : '#94a3b8',
  })

  return (
    <>
      <h1>Carrier &amp; State Coverage</h1>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="card"><div className="stat">{model.rows.length}</div><div className="stat-label">Active agents</div></div>
        <div className="card"><div className="stat" style={{ color: '#166534' }}>{model.fullyCovered}</div><div className="stat-label">Fully covered</div></div>
        <div className="card"><div className="stat" style={{ color: '#92400e' }}>{model.rows.length - model.fullyCovered}</div><div className="stat-label">With gaps</div></div>
        <div className="card"><div className="stat">{model.planYear}</div><div className="stat-label">Plan year</div></div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
          <input placeholder="Search agent or NPN…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 260 }} />
          <label style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={gapsOnly} onChange={e => setGapsOnly(e.target.checked)} style={{ width: 'auto' }} />
            Show only agents with gaps
          </label>
          <span style={{ color: '#64748b', fontSize: 13 }}>
            {filtered.length} agents · cell = RTS states / licensed states where the carrier sells plans
            · grey — = carrier has no plans in the agent&apos;s states · click a cell for missing states
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th style={{ textAlign: 'center' }}>Lic. states</th>
                {model.carriers.map((c, i) => (
                  <th key={c} style={{ textAlign: 'center' }}>
                    {SHORT[c] || c}
                    <div style={{ fontWeight: 400, fontSize: 11, color: model.perCarrierMissing[i] ? '#991b1b' : '#64748b' }}>
                      {model.perCarrierMissing[i]} missing
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <FragmentRow key={r.npn} row={r} expanded={expanded === r.npn}
                  onToggle={() => setExpanded(expanded === r.npn ? null : r.npn)}
                  cellStyle={cellStyle} carrierCount={model.carriers.length} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function FragmentRow({ row, expanded, onToggle, cellStyle, carrierCount }) {
  return (
    <>
      <tr>
        <td style={{ whiteSpace: 'nowrap' }}>
          <Link to={`/agents/${row.npn}`}>{row.name}</Link>
          <div style={{ fontSize: 11, color: '#64748b' }}>{row.npn}</div>
        </td>
        <td style={{ textAlign: 'center' }}>{row.licensed.length}</td>
        {row.cells.map(c => (
          <td key={c.carrier} style={cellStyle(c.level)} onClick={onToggle}
              title={c.level === 'na' ? 'Carrier sells no plans in this agent’s licensed states'
                : c.missing.length ? `Missing: ${c.missing.join(', ')}` : 'Fully appointed'}>
            {c.level === 'na' ? '—' : `${c.covered}/${c.total}`}
          </td>
        ))}
      </tr>
      {expanded && (
        <tr>
          <td colSpan={carrierCount + 2} style={{ background: '#f8fafc' }}>
            <div style={{ display: 'grid', gap: 6, padding: '4px 0' }}>
              {row.cells.filter(c => c.missing.length > 0).map(c => (
                <div key={c.carrier} style={{ fontSize: 13 }}>
                  <strong>{c.carrier}</strong>
                  <span className={`badge ${c.level === 'none' ? 'badge-n' : 'badge-warn'}`} style={{ margin: '0 8px' }}>
                    {c.level === 'none' ? 'no appointments' : `missing ${c.missing.length}`}
                  </span>
                  <span style={{ color: '#64748b' }}>{c.missing.join(', ')}</span>
                </div>
              ))}
              {row.cells.every(c => c.missing.length === 0) && (
                <div style={{ fontSize: 13, color: '#166534' }}>Fully appointed with every carrier in all licensed states.</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
