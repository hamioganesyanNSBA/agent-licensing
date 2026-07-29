import { useEffect, useMemo, useState } from 'react'
import { fetchAll } from '../lib/fetchAll.js'
import { useLicensedNpns } from '../lib/useLicensedNpns.js'
import { Th, useSortState, sortCompare } from '../components/SortHeader.jsx'
import Pagination from '../components/Pagination.jsx'

const PER_PAGE = 20

const COLUMNS = [
  { key: 'last_name',        label: 'Agent' },
  { key: 'agent_npn',        label: 'NPN' },
  { key: 'carrier',          label: 'Carrier' },
  { key: 'plan_year',        label: 'Year' },
  { key: 'state',            label: 'State' },
  { key: 'product_category', label: 'Product' },
  { key: 'rts_status',       label: 'RTS' },
]

export default function Appointments() {
  const [rows, setRows] = useState([])
  const [carrier, setCarrier] = useState('')
  const [state, setState] = useState('')
  const [year, setYear] = useState(2026)
  const [rts, setRts] = useState('')
  const [name, setName] = useState('')
  const [sort, toggleSort] = useSortState('last_name')
  const [page, setPage] = useState(1)
  const licensedNpns = useLicensedNpns()

  // Load everything once (paginated past Supabase's 1000-row cap); filters run
  // client-side so results are never silently truncated.
  useEffect(() => {
    fetchAll('carrier_appointments',
      'agent_npn,first_name,last_name,carrier,plan_year,state,product_category,rts_status')
      .then(setRows)
  }, [])

  useEffect(() => { setPage(1) }, [carrier, state, year, rts, name, sort])

  const sorted = useMemo(() => {
    if (!licensedNpns) return []
    let out = rows.filter(r => licensedNpns.has(r.agent_npn))
    if (carrier) out = out.filter(r => r.carrier === carrier)
    if (state)   out = out.filter(r => r.state === state)
    if (year)    out = out.filter(r => r.plan_year === year)
    if (rts)     out = out.filter(r => r.rts_status === rts)
    if (name) {
      const s = name.toLowerCase()
      out = out.filter(r =>
        (r.first_name || '').toLowerCase().includes(s) || (r.last_name || '').toLowerCase().includes(s))
    }
    return out.sort(sortCompare(sort))
  }, [rows, licensedNpns, carrier, state, year, rts, name, sort])

  const slice = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  return (
    <>
      <h1>Carrier Appointments</h1>
      <div className="card">
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <select value={carrier} onChange={e => setCarrier(e.target.value)}>
            <option value="">All carriers</option>
            <option>Aetna</option>
            <option>UnitedHealthcare</option>
            <option>Devoted</option>
            <option>Wellcare</option>
            <option>Anthem</option>
            <option>Cigna</option>
            <option>SCAN</option>
            <option>Zing</option>
          </select>
          <input placeholder="State" value={state} onChange={e => setState(e.target.value.toUpperCase())} style={{ width: 100 }} />
          <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))}>
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>
          <input placeholder="Agent name" value={name} onChange={e => setName(e.target.value)} style={{ width: 180 }} />
          <select value={rts} onChange={e => setRts(e.target.value)}>
            <option value="">All RTS</option>
            <option value="Y">Ready (Y)</option>
            <option value="N">Not ready (N)</option>
          </select>
          <span style={{ color: '#64748b', fontSize: 13 }}>{sorted.length} rows</span>
        </div>
        <table>
          <thead>
            <tr>{COLUMNS.map(c => <Th key={c.key} col={c} sort={sort} onToggle={toggleSort} />)}</tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={i}>
                <td>{r.last_name}, {r.first_name}</td>
                <td>{r.agent_npn}</td>
                <td>{r.carrier}</td>
                <td>{r.plan_year}</td>
                <td>{r.state}</td>
                <td>{r.product_category}</td>
                <td><span className={`badge ${r.rts_status === 'Y' ? 'badge-y' : 'badge-n'}`}>{r.rts_status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} total={sorted.length} perPage={PER_PAGE} onChange={setPage} />
      </div>
    </>
  )
}
