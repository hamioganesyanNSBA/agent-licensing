import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { EXPIRING_WINDOW_DAYS, expiringLicenses, daysUntil } from '../lib/renewals.js'

export default function AgentDetail() {
  const { npn } = useParams()
  const [agent, setAgent] = useState(null)
  const [licenses, setLicenses] = useState([])
  const [appts, setAppts] = useState([])
  const [licenseFilter, setLicenseFilter] = useState('active')

  useEffect(() => { load() }, [npn])

  async function load() {
    const [a, l, ap] = await Promise.all([
      supabase.from('agents').select('*').eq('npn', npn).maybeSingle(),
      supabase.from('licenses').select('*').eq('npn', npn).order('state'),
      supabase.from('carrier_appointments').select('*').eq('agent_npn', npn).order('carrier').order('state'),
    ])
    setAgent(a.data)
    setLicenses(l.data || [])
    setAppts(ap.data || [])
  }

  if (!agent) return <div><Link to="/agents">← Agents</Link><p>Loading…</p></div>

  const filteredLicenses = licenses.filter(r => {
    if (licenseFilter === 'all') return true
    if (licenseFilter === 'active') return r.status === 'Active'
    return r.status !== 'Active'
  })

  const expiring = expiringLicenses(licenses)
  const expiringDates = new Set(expiring.map(l => `${l.state}|${l.expiration_date}`))

  return (
    <>
      <Link to="/agents">← Agents</Link>
      <h1>{agent.first_name} {agent.last_name}</h1>
      <p style={{ color: '#64748b' }}>NPN {agent.npn} · {agent.email}</p>

      {expiring.length > 0 && (
        <div className="card" style={{ borderColor: '#fcd34d', background: '#fffbeb',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <strong>⚠ {expiring.length} license{expiring.length === 1 ? '' : 's'} expiring</strong>
            <span style={{ color: '#92400e' }}>
              {' '}within {EXPIRING_WINDOW_DAYS} days
              {' '}(earliest: {expiring[0].state} on {expiring[0].expiration_date})
            </span>
          </div>
          <Link className="btn" to={`/renewals/${agent.npn}`} style={{ whiteSpace: 'nowrap' }}>
            Renew now →
          </Link>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Licenses ({filteredLicenses.length})</h2>
          <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
            {['active', 'all', 'inactive'].map(opt => (
              <button
                key={opt}
                onClick={() => setLicenseFilter(opt)}
                style={{
                  padding: '6px 12px',
                  border: 0,
                  background: licenseFilter === opt ? 'var(--nsba-navy)' : '#fff',
                  color: licenseFilter === opt ? '#fff' : 'var(--nsba-navy)',
                  fontSize: 13,
                  textTransform: 'capitalize',
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
        <table>
          <thead><tr><th>State</th><th>Type</th><th>LOA</th><th>Number</th><th>Status</th><th>Expires</th></tr></thead>
          <tbody>
            {filteredLicenses.map((r, i) => (
              <tr key={i}>
                <td>{r.state}</td><td>{r.license_type}</td><td>{r.loa}</td>
                <td>{r.license_number}</td>
                <td><span className={`badge ${r.status === 'Active' ? 'badge-y' : 'badge-n'}`}>{r.status}</span></td>
                <td style={expiringDates.has(`${r.state}|${r.expiration_date}`)
                  ? { color: daysUntil(r.expiration_date) < 0 ? '#991b1b' : '#b45309', fontWeight: 600 }
                  : undefined}>
                  {r.expiration_date}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Carrier appointments ({appts.length})</h2>
        <table>
          <thead><tr><th>Carrier</th><th>Plan Year</th><th>State</th><th>Product</th><th>RTS</th></tr></thead>
          <tbody>
            {appts.map((r, i) => (
              <tr key={i}>
                <td>{r.carrier}</td><td>{r.plan_year}</td><td>{r.state}</td><td>{r.product_category}</td>
                <td><span className={`badge ${r.rts_status === 'Y' ? 'badge-y' : 'badge-n'}`}>{r.rts_status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
