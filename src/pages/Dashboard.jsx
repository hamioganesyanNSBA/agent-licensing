import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { TIER_1, TIER_2, ALL_REQUIRED } from '../lib/tiers.js'
import { toStateCode } from '../lib/states.js'
import USMap from '../components/USMap.jsx'
import Pagination from '../components/Pagination.jsx'

const PER_PAGE = 10

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [expiring, setExpiring] = useState([])
  const [gaps, setGaps] = useState([])
  const [complete, setComplete] = useState([])
  const [gapPage, setGapPage] = useState(1)
  const [completePage, setCompletePage] = useState(1)
  const [expPage, setExpPage] = useState(1)

  useEffect(() => { load() }, [])

  async function load() {
    const today = new Date().toISOString().slice(0, 10)
    const in60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)

    const allLicsRes = await supabase
      .from('licenses')
      .select('npn,licensee_name,state,status,expiration_date,loa')
      .limit(10000)

    const allLics = allLicsRes.data || []
    const licensedNpns = new Set(allLics.map(l => l.npn))
    const npnList = [...licensedNpns]

    const [appt, lic] = await Promise.all([
      supabase.from('carrier_appointments')
        .select('id', { count: 'exact', head: true })
        .eq('rts_status', 'Y')
        .in('agent_npn', npnList),
      supabase.from('licenses')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Active'),
    ])

    const expiringAll = allLics.filter(l =>
      l.status === 'Active' && l.expiration_date &&
      l.expiration_date >= today && l.expiration_date <= in60
    ).sort((a, b) => a.expiration_date.localeCompare(b.expiration_date))

    setStats({
      agents:       licensedNpns.size,
      activeLics:   lic.count ?? 0,
      readyAppts:   appt.count ?? 0,
      expiringSoon: expiringAll.length,
    })
    setExpiring(expiringAll)

    // Build compliance per agent
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
    const agentComplete = []
    for (const [npn, have] of Object.entries(licByAgent)) {
      const missingT1 = TIER_1.filter(s => !have.has(s))
      const missingT2 = TIER_2.filter(s => !have.has(s))
      if (missingT1.length || missingT2.length) {
        agentGaps.push({ npn, name: agentNames[npn] || npn, missingT1, missingT2, total: missingT1.length + missingT2.length })
      } else {
        agentComplete.push({ npn, name: agentNames[npn] || npn })
      }
    }
    agentGaps.sort((a, b) => b.total - a.total)
    agentComplete.sort((a, b) => a.name.localeCompare(b.name))
    setGaps(agentGaps)
    setComplete(agentComplete)
  }

  if (!stats) return <div>Loading…</div>

  const gapSlice = gaps.slice((gapPage - 1) * PER_PAGE, gapPage * PER_PAGE)
  const completeSlice = complete.slice((completePage - 1) * PER_PAGE, completePage * PER_PAGE)
  const expSlice = expiring.slice((expPage - 1) * PER_PAGE, expPage * PER_PAGE)

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
          <>
            <table>
              <thead>
                <tr><th>Agent</th><th>NPN</th><th>Missing Tier 1 (Onboarding)</th><th>Missing Tier 2 (Metrics)</th></tr>
              </thead>
              <tbody>
                {gapSlice.map((g, i) => (
                  <tr key={i}>
                    <td>{g.name}</td>
                    <td>{g.npn}</td>
                    <td>{g.missingT1.length === 0 ? <span className="badge badge-y">All set</span> : g.missingT1.map(s => <span key={s} className="badge badge-n" style={{ marginRight: 4 }}>{s}</span>)}</td>
                    <td>{g.missingT2.length === 0 ? <span className="badge badge-y">All set</span> : g.missingT2.map(s => <span key={s} className="badge badge-warn" style={{ marginRight: 4 }}>{s}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={gapPage} total={gaps.length} perPage={PER_PAGE} onChange={setGapPage} />
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>All Required States Complete ({complete.length} agents)</h2>
        {complete.length === 0 ? <p>No agents have all required states yet.</p> : (
          <>
            <table>
              <thead><tr><th>Agent</th><th>NPN</th><th>Status</th></tr></thead>
              <tbody>
                {completeSlice.map((a, i) => (
                  <tr key={i}>
                    <td>{a.name}</td>
                    <td>{a.npn}</td>
                    <td><span className="badge badge-y">All 20 states</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={completePage} total={complete.length} perPage={PER_PAGE} onChange={setCompletePage} />
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Licenses expiring in next 60 days</h2>
        {expiring.length === 0 ? <p>None.</p> : (
          <>
            <table>
              <thead><tr><th>Licensee</th><th>NPN</th><th>State</th><th>LOA</th><th>Expires</th></tr></thead>
              <tbody>
                {expSlice.map((r, i) => (
                  <tr key={i}>
                    <td>{r.licensee_name}</td><td>{r.npn}</td><td>{r.state}</td><td>{r.loa}</td><td>{r.expiration_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={expPage} total={expiring.length} perPage={PER_PAGE} onChange={setExpPage} />
          </>
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
