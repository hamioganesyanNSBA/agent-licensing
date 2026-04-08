import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

export default function Agents() {
  const [agents, setAgents] = useState([])
  const [q, setQ] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase
      .from('agents')
      .select('npn,first_name,last_name,email')
      .order('last_name', { ascending: true })
      .limit(1000)
    setAgents(data || [])
  }

  const filtered = agents.filter(a => {
    if (!q) return true
    const s = q.toLowerCase()
    return (a.first_name || '').toLowerCase().includes(s)
        || (a.last_name  || '').toLowerCase().includes(s)
        || (a.email      || '').toLowerCase().includes(s)
        || (a.npn        || '').includes(s)
  })

  return (
    <>
      <h1>Agents</h1>
      <div className="card">
        <input placeholder="Search by name, email, or NPN…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 320 }} />
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 8 }}>{filtered.length} of {agents.length}</p>
        <table>
          <thead><tr><th>Name</th><th>NPN</th><th>Email</th></tr></thead>
          <tbody>
            {filtered.map(a => (
              <tr key={a.npn}>
                <td><Link to={`/agents/${a.npn}`}>{a.last_name}, {a.first_name}</Link></td>
                <td>{a.npn}</td>
                <td>{a.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
