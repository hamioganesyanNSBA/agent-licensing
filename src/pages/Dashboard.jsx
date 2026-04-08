import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [expiring, setExpiring] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    const today = new Date().toISOString().slice(0, 10)
    const in60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)

    const [agents, lic, appt, exp] = await Promise.all([
      supabase.from('agents').select('npn', { count: 'exact', head: true }),
      supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('status', 'Active'),
      supabase.from('carrier_appointments').select('id', { count: 'exact', head: true }).eq('rts_status', 'Y'),
      supabase.from('licenses')
        .select('npn,licensee_name,state,expiration_date,loa,status')
        .eq('status', 'Active')
        .gte('expiration_date', today)
        .lte('expiration_date', in60)
        .order('expiration_date', { ascending: true })
        .limit(50),
    ])

    setStats({
      agents:       agents.count    ?? 0,
      activeLics:   lic.count       ?? 0,
      readyAppts:   appt.count      ?? 0,
      expiringSoon: exp.data?.length ?? 0,
    })
    setExpiring(exp.data || [])
  }

  if (!stats) return <div>Loading…</div>
  return (
    <>
      <h1>Dashboard</h1>
      <div className="grid grid-4">
        <Stat label="Agents" value={stats.agents} />
        <Stat label="Active license rows" value={stats.activeLics} />
        <Stat label="RTS-ready appointments" value={stats.readyAppts} />
        <Stat label="Expiring in 60 days" value={stats.expiringSoon} />
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Licenses expiring in next 60 days</h2>
        {expiring.length === 0 ? <p>None.</p> : (
          <table>
            <thead><tr><th>Licensee</th><th>NPN</th><th>State</th><th>LOA</th><th>Expires</th></tr></thead>
            <tbody>
              {expiring.map((r, i) => (
                <tr key={i}>
                  <td>{r.licensee_name}</td>
                  <td>{r.npn}</td>
                  <td>{r.state}</td>
                  <td>{r.loa}</td>
                  <td>{r.expiration_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function Stat({ label, value }) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat">{value}</div>
    </div>
  )
}
