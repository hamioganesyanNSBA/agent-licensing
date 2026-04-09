import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import Pagination from '../components/Pagination.jsx'

const PER_PAGE = 20

export default function Licenses() {
  const [rows, setRows] = useState([])
  const [state, setState] = useState('')
  const [status, setStatus] = useState('Active')
  const [expiringDays, setExpiringDays] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => { load() }, [state, status, expiringDays])
  useEffect(() => { setPage(1) }, [state, status, expiringDays])

  async function load() {
    let q = supabase.from('licenses')
      .select('npn,licensee_name,state,license_type,loa,license_number,status,expiration_date')
      .order('expiration_date', { ascending: true })
      .limit(5000)
    if (state)  q = q.eq('state', state)
    if (status) q = q.eq('status', status)
    if (expiringDays) {
      const today = new Date().toISOString().slice(0, 10)
      const future = new Date(Date.now() + parseInt(expiringDays, 10) * 86400000).toISOString().slice(0, 10)
      q = q.gte('expiration_date', today).lte('expiration_date', future)
    }
    const { data } = await q
    setRows(data || [])
  }

  const slice = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  return (
    <>
      <h1>Licenses</h1>
      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
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
          <span style={{ color: '#64748b', fontSize: 13 }}>{rows.length} rows</span>
        </div>
        <table>
          <thead><tr><th>Licensee</th><th>NPN</th><th>State</th><th>Type</th><th>LOA</th><th>Number</th><th>Status</th><th>Expires</th></tr></thead>
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
        <Pagination page={page} total={rows.length} perPage={PER_PAGE} onChange={setPage} />
      </div>
    </>
  )
}
