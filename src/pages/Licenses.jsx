import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fetchAll } from '../lib/fetchAll.js'
import Pagination from '../components/Pagination.jsx'

const PER_PAGE = 20

const COLUMNS = [
  { key: 'licensee_name',   label: 'Licensee' },
  { key: 'npn',             label: 'NPN' },
  { key: 'state',           label: 'State' },
  { key: 'license_type',    label: 'Type' },
  { key: 'loa',             label: 'LOA' },
  { key: 'license_number',  label: 'Number' },
  { key: 'status',          label: 'Status' },
  { key: 'expiration_date', label: 'Expires' },
]

export default function Licenses() {
  const [searchParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [state, setState] = useState(searchParams.get('state') || '')
  const [status, setStatus] = useState(searchParams.get('status') ?? 'Active')
  const [expiringDays, setExpiringDays] = useState(searchParams.get('expiring') || '')
  const [sort, setSort] = useState({ key: 'expiration_date', dir: 'asc' })
  const [page, setPage] = useState(1)

  // Load the whole table once (paginated past Supabase's 1000-row cap);
  // all filtering happens client-side so nothing is ever truncated.
  useEffect(() => {
    fetchAll('licenses', 'npn,licensee_name,state,license_type,loa,license_number,status,expiration_date')
      .then(setRows)
  }, [])
  useEffect(() => { setPage(1) }, [q, state, status, expiringDays, sort])

  function toggleSort(key) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  const visible = useMemo(() => {
    let out = rows
    if (state)  out = out.filter(r => r.state === state)
    if (status) out = out.filter(r => r.status === status)
    if (expiringDays) {
      const today = new Date().toISOString().slice(0, 10)
      const future = new Date(Date.now() + parseInt(expiringDays, 10) * 86400000).toISOString().slice(0, 10)
      out = out.filter(r => r.expiration_date && r.expiration_date >= today && r.expiration_date <= future)
    }
    if (q) {
      const s = q.toLowerCase()
      out = out.filter(r =>
        (r.licensee_name || '').toLowerCase().includes(s) || (r.npn || '').includes(s))
    }
    const { key, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    return [...out].sort((a, b) => {
      const av = a[key], bv = b[key]
      if (av == null && bv == null) return 0
      if (av == null) return 1          // nulls always last
      if (bv == null) return -1
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * mul
    })
  }, [rows, q, state, status, expiringDays, sort])

  const slice = visible.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  return (
    <>
      <h1>Licenses</h1>
      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <input placeholder="Search agent or NPN…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 220 }} />
          <input placeholder="State (e.g. CA)" value={state} onChange={e => setState(e.target.value.toUpperCase())} style={{ width: 120 }} />
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option>Active</option>
            <option>Inactive</option>
          </select>
          <select value={expiringDays} onChange={e => setExpiringDays(e.target.value)}>
            <option value="">All expirations</option>
            <option value="30">Expiring &le;30 days</option>
            <option value="60">Expiring &le;60 days</option>
            <option value="90">Expiring &le;90 days</option>
          </select>
          <span style={{ color: '#64748b', fontSize: 13 }}>{visible.length} rows · click a column to sort</span>
        </div>
        <table>
          <thead>
            <tr>
              {COLUMNS.map(c => (
                <th key={c.key} onClick={() => toggleSort(c.key)}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                  {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={i}>
                <td>{r.licensee_name}</td><td>{r.npn}</td><td>{r.state}</td>
                <td>{r.license_type}</td><td>{r.loa}</td><td>{r.license_number}</td>
                <td><span className={`badge ${r.status === 'Active' ? 'badge-y' : 'badge-n'}`}>{r.status}</span></td>
                <td>{r.expiration_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} total={visible.length} perPage={PER_PAGE} onChange={setPage} />
      </div>
    </>
  )
}
