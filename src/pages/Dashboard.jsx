import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { TIER_1, TIER_2, ALL_REQUIRED } from '../lib/tiers.js'
import USMap from '../components/USMap.jsx'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [expiring, setExpiring] = useState([])
  const [gaps, setGaps] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    const today = new Date().toISOString().slice(0, 10)
    const in60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)

    const [agents, lic, appt, exp, allAgents, allLics] = await Promise.all([
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
      supabase.from('agents').select('npn,first_name,last_name').order('last_name'),
      supabase.from('licenses').select('npn,state,status').eq('status', 'Active'),
    ])

    setStats({
      agents:       agents.count    ?? 0,
      activeLics:   lic.count       ?? 0,
      readyAppts:   appt.count      ?? 0,
      expiringSoon: exp.data?.length ?? 0,
    })
    setExpiring(exp.data || [])

    // Build compliance gaps
    const licByAgent = {}
    for (const l of (allLics.data || [])) {
      if (!licByAgent[l.npn]) licByAgent[l.npn] = new Set()
      licByAgent[l.npn].add(l.state)
    }

    const agentGaps = []
    for (const a of (allAgents.data || [])) {
      const have = licByAgent[a.npn] || new Set()
      const missingT1 = TIER_1.filter(s => !have.has(s))
      const missingT2 = TIER_2.filter(s => !have.has(s))
      if (missingT1.length || missingT2.length) {
        agentGaps.push({
          npn: a.npn,
          name: `${a.last_name}, ${a.first_name}`,
          missingT1,
          missingT2,
          total: missingT1.length + missingT2.length,
        })
      }
    }
    agentGaps.sort((a, b) => b.total - a.total)
    setGaps(agentGaps)
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

      <div style={{ marginTop: 24 }}>
        <USMap />
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Missing Required Licenses ({gaps.length} agents)</h2>
        {gaps.length === 0 ? <p>All agents have required licenses.</p> : (
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>NPN</th>
                <th>Missing Tier 1 (Onboarding)</th>
                <th>Missing Tier 2 (Metrics)</th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g, i) => (
                <tr key={i}>
                  <td>{g.name}</td>
                  <td>{g.npn}</td>
                  <td>
                    {g.missingT1.length === 0
                      ? <span className="badge badge-y">All set</span>
                      : g.missingT1.map(s => <span key={s} className="badge badge-n" style={{ marginRight: 4 }}>{s}</span>)}
                  </td>
                  <td>
                    {g.missingT2.length === 0
                      ? <span className="badge badge-y">All set</span>
                      : g.missingT2.map(s => <span key={s} className="badge badge-warn" style={{ marginRight: 4 }}>{s}</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
