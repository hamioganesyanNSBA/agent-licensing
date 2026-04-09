import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useLicensedNpns } from '../lib/useLicensedNpns.js'
import Pagination from '../components/Pagination.jsx'

const PER_PAGE = 20

export default function Appointments() {
  const [rows, setRows] = useState([])
  const [carrier, setCarrier] = useState('')
  const [state, setState] = useState('')
  const [year, setYear] = useState(2026)
  const [rts, setRts] = useState('')
  const [name, setName] = useState('')
  const [page, setPage] = useState(1)
  const licensedNpns = useLicensedNpns()

  useEffect(() => {
    if (!licensedNpns) return
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [carrier, state, year, rts, name, licensedNpns])

  useEffect(() => { setPage(1) }, [carrier, state, year, rts, name])

  async function load() {
    let q = supabase.from('carrier_appointments')
      .select('agent_npn,first_name,last_name,carrier,plan_year,state,product_category,rts_status')
      .order('last_name')
      .limit(5000)
    if (carrier) q = q.eq('carrier', carrier)
    if (state)   q = q.eq('state', state)
    if (year)    q = q.eq('plan_year', year)
    if (rts)     q = q.eq('rts_status', rts)
    if (name) {
      const term = `%${name}%`
      q = q.or(`first_name.ilike.${term},last_name.ilike.${term}`)
    }
    q = q.in('agent_npn', [...licensedNpns])
    const { data } = await q
    setRows(data || [])
  }

  const slice = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE)

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
          </select>
          <input placeholder="Agent name" value={name} onChange={e => setName(e.target.value)} style={{ width: 180 }} />
          <select value={rts} onChange={e => setRts(e.target.value)}>
            <option value="">All RTS</option>
            <option value="Y">Ready (Y)</option>
            <option value="N">Not ready (N)</option>
          </select>
          <span style={{ color: '#64748b', fontSize: 13 }}>{rows.length} rows</span>
        </div>
        <table>
          <thead><tr><th>Agent</th><th>NPN</th><th>Carrier</th><th>Year</th><th>State</th><th>Product</th><th>RTS</th></tr></thead>
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
        <Pagination page={page} total={rows.length} perPage={PER_PAGE} onChange={setPage} />
      </div>
    </>
  )
}
