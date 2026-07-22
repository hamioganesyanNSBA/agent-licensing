import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchAll } from '../lib/fetchAll.js'
import { buildCoverageModel, CARRIER_SHORT } from '../lib/coverageModel.js'
import { Th, useSortState, sortCompare } from '../components/SortHeader.jsx'
import Pagination from '../components/Pagination.jsx'

const PER_PAGE = 20

const COLUMNS = [
  { key: 'sortName', label: 'Name' },
  { key: 'npn',      label: 'NPN' },
  { key: 'email',    label: 'Email' },
  { key: 'gapCount', label: 'Missing appointments' },
]

export default function Agents() {
  const [agents, setAgents] = useState(null)
  const [licenses, setLicenses] = useState(null)
  const [appointments, setAppointments] = useState(null)
  const [q, setQ] = useState('')
  const [sort, toggleSort] = useSortState('sortName')
  const [page, setPage] = useState(1)

  useEffect(() => {
    fetchAll('agents', 'npn,first_name,last_name,email').then(setAgents)
    fetchAll('licenses', 'npn,state,status,expiration_date').then(setLicenses)
    fetchAll('carrier_appointments', 'agent_npn,carrier,plan_year,state,rts_status').then(setAppointments)
  }, [])

  useEffect(() => { setPage(1) }, [q, sort])

  const rows = useMemo(() => {
    if (!agents || !licenses || !appointments) return null
    const coverage = buildCoverageModel(licenses, appointments, agents)
    const licensedNpns = new Set(licenses.map(l => l.npn))
    return agents
      .filter(a => licensedNpns.has(a.npn))
      .map(a => {
        const cov = coverage.byNpn.get(a.npn)
        return {
          ...a,
          sortName: `${a.last_name || ''}, ${a.first_name || ''}`,
          gapCount: cov ? cov.gapCount : null,   // null = no active licenses
          gaps: cov ? cov.cells.filter(c => c.level === 'none' || c.level === 'partial') : [],
        }
      })
  }, [agents, licenses, appointments])

  if (!rows) return <><h1>Agents</h1><div className="card">Loading…</div></>

  const filtered = rows.filter(a => {
    if (!q) return true
    const s = q.toLowerCase()
    return (a.first_name || '').toLowerCase().includes(s)
        || (a.last_name  || '').toLowerCase().includes(s)
        || (a.email      || '').toLowerCase().includes(s)
        || (a.npn        || '').includes(s)
  }).sort(sortCompare(sort))

  const slice = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  return (
    <>
      <h1>Agents</h1>
      <div className="card">
        <input placeholder="Search by name, email, or NPN…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 320 }} />
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 8 }}>
          {filtered.length} agents · red = no appointments with that carrier, amber = missing some states · hover a chip for the states
        </p>
        <table>
          <thead>
            <tr>{COLUMNS.map(c => <Th key={c.key} col={c} sort={sort} onToggle={toggleSort} />)}</tr>
          </thead>
          <tbody>
            {slice.map(a => (
              <tr key={a.npn}>
                <td style={{ whiteSpace: 'nowrap' }}><Link to={`/agents/${a.npn}`}>{a.last_name}, {a.first_name}</Link></td>
                <td>{a.npn}</td>
                <td>{a.email}</td>
                <td>
                  {a.gapCount === null ? <span style={{ color: '#94a3b8' }}>no active licenses</span>
                    : a.gapCount === 0 ? <span className="badge badge-y">fully appointed</span>
                    : a.gaps.map(g => (
                        <span key={g.carrier}
                              className={`badge ${g.level === 'none' ? 'badge-n' : 'badge-warn'}`}
                              style={{ marginRight: 4 }}
                              title={g.level === 'none'
                                ? `${g.carrier}: no RTS appointments (needs ${g.missing.join(', ')})`
                                : `${g.carrier}: missing ${g.missing.join(', ')}`}>
                          {CARRIER_SHORT[g.carrier] || g.carrier}{g.level === 'partial' ? ` ${g.covered}/${g.total}` : ''}
                        </span>
                      ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={setPage} />
      </div>
    </>
  )
}
