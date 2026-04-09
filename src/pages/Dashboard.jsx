import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { TIER_1, TIER_2, ALL_REQUIRED } from '../lib/tiers.js'
import { toStateCode } from '../lib/states.js'
import USMap from '../components/USMap.jsx'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [expiring, setExpiring] = useState([])
  const [gaps, setGaps] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    const today = new Date().toISOString().slice(0, 10)
    const in60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)

    // Fetch all license rows first — this is the source of truth for who is an agent
    const allLicsRes = await supabase
      .from('licenses')
      .select('npn,licensee_name,state,status,expiration_date,loa')
      .limit(10000)

    const allLics = allLicsRes.data || []

    // Build licensed NPN set
    const licensedNpns = new Set(allLics.map(l => l.npn))
    const npnList = [...licensedNpns]

    // Now fetch stats scoped to licensed agents
    const [appt, lic] = await Promise.all([
      supabase.from('carrier_appointments')
        .select('id', { count: 'exact', head: true })
        .eq('rts_status', 'Y')
        .in('agent_npn', npnList),
      supabase.from('licenses')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Active'),
    ])

    // Expiring licenses in next 60 days
    const expiring = allLics.filter(l =>
      l.status === 'Active' && l.expiration_date &&
      l.expiration_date >= today && l.expiration_date <= in60
    ).sort((a, b) => a.expiration_date.localeCompare(b.expiration_date)).slice(0, 50)

    setStats({
      agents:       licensedNpns.size,
      activeLics:   lic.count ?? 0,
      readyAppts:   appt.count ?? 0,
      expiringSoon: expiring.length,
    })
    setExpiring(expiring)

    // Build compliance gaps — only for agents in the license report
    const licByAgent = {}
    const agentNames = {}
    for (const l of allLics) {
      if (l.status !== 'Active') continue
      if (!licByAgent[l.npn]) licByAgent[l.npn] = new Set()
      const code = toStateCode(l.state)
      if (code) licByAgent[l.npn].add(code)
      if (!agentNames[l.npn]) agentNames[l.npn] = l.licensee_name
    }

    const agentGaps = []
    for (const [npn, have] of Object.entries(licByAgent)) {
      const missingT1 = TIER_1.filter(s => !have.has(s))
      const missingT2 = TIER_2.filter(s => !have.has(s))
      if (missingT1.length || missingT2.length) {
        agentGaps.push({
          npn,
          name: agentNames[npn] || npn,
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
