import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase.js'
import { fetchAll } from '../lib/fetchAll.js'
import { useIsEditor } from '../lib/useIsEditor.js'
import Pagination from '../components/Pagination.jsx'
import { parseSirconCsv, fmtMoney, presetRange, PRESETS } from '../lib/sirconCosts.js'

const PER_PAGE = 25
const BREAKDOWNS = [['month', 'By month'], ['agent', 'By agent'], ['service', 'By service'], ['state', 'By state']]

export default function Costs() {
  const isEditor = useIsEditor()
  const { user } = useUser()
  const [rows, setRows] = useState(null)
  const [rosterNpns, setRosterNpns] = useState(new Set())
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [error, setError] = useState('')
  const [uploadMsg, setUploadMsg] = useState('')
  const [uploading, setUploading] = useState(false)

  const [preset, setPreset] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const [stateF, setStateF] = useState('')
  const [serviceF, setServiceF] = useState('')
  const [breakdown, setBreakdown] = useState('month')
  const [page, setPage] = useState(1)

  useEffect(() => { load() }, [])
  useEffect(() => { setPage(1) }, [preset, from, to, q, stateF, serviceF])

  async function load() {
    fetchAll('agents', 'npn').then(a => setRosterNpns(new Set(a.map(x => x.npn)))).catch(() => {})
    try {
      setRows(await fetchAll('licensing_costs', '*'))
    } catch (e) {
      if (/does not exist|42P01|schema cache|PGRST205/i.test(e.message || '')) setSetupNeeded(true)
      else setError(e.message || String(e))
      setRows([])
    }
  }

  async function countAll() {
    const { count } = await supabase.from('licensing_costs')
      .select('id', { count: 'exact', head: true })
    return count || 0
  }

  async function upload(files) {
    if (!files?.length) return
    setUploading(true); setError(''); setUploadMsg('')
    try {
      let parsed = []
      for (const f of files) parsed = parsed.concat(await parseSirconCsv(f))
      // Dedupe within the batch on the table's conflict key.
      const byKey = new Map()
      for (const r of parsed) {
        byKey.set(`${r.confirmation_id}|${r.service_code}|${r.state_fee}|${r.sircon_fee}`, r)
      }
      const batch = [...byKey.values()]
      if (!batch.length) throw new Error('No usable rows found in the selected file(s).')
      const before = await countAll()
      for (let i = 0; i < batch.length; i += 500) {
        const { error } = await supabase.from('licensing_costs').upsert(batch.slice(i, i + 500), {
          onConflict: 'confirmation_id,service_code,state_fee,sircon_fee',
          ignoreDuplicates: true,
        })
        if (error) throw error
      }
      const added = await countAll() - before
      await supabase.from('import_runs').insert({
        source: 'sircon-costs',
        filename: [...files].map(f => f.name).join('; ').slice(0, 500),
        row_count: added,
        imported_by: user?.primaryEmailAddress?.emailAddress || null,
        notes: `${parsed.length} rows in ${files.length} file(s), ${added} new`,
      }).then(() => {}, () => {})
      setUploadMsg(`Processed ${parsed.length} rows from ${files.length} file(s) — ${added} new, ${parsed.length - added} already recorded.`)
      await load()
    } catch (e) { setError(e.message || String(e)) }
    finally { setUploading(false) }
  }

  const range = preset === 'custom' ? { from: from || null, to: to || null } : presetRange(preset)

  const filtered = useMemo(() => {
    if (!rows) return []
    const s = q.trim().toLowerCase()
    return rows.filter(r => {
      if (range.from && r.date < range.from) return false
      if (range.to && r.date > range.to) return false
      if (stateF && r.state !== stateF) return false
      if (serviceF && r.service_desc !== serviceF) return false
      if (s && !((r.producer_name || '').toLowerCase().includes(s)
        || (r.npn || '').includes(s)
        || (r.requested_by || '').toLowerCase().includes(s))) return false
      return true
    }).sort((a, b) => b.date.localeCompare(a.date) || (b.id - a.id))
  }, [rows, range.from, range.to, q, stateF, serviceF])

  const totals = useMemo(() => filtered.reduce((t, r) => ({
    count: t.count + 1,
    state: t.state + Number(r.state_fee || 0),
    sircon: t.sircon + Number(r.sircon_fee || 0),
  }), { count: 0, state: 0, sircon: 0 }), [filtered])

  const groups = useMemo(() => {
    const make = (keyFn, labelFn) => {
      const m = new Map()
      for (const r of filtered) {
        const k = keyFn(r)
        let g = m.get(k)
        if (!g) { g = { key: k, label: labelFn(r), count: 0, state: 0, sircon: 0, states: new Set(), npn: r.npn }; m.set(k, g) }
        g.count++
        g.state += Number(r.state_fee || 0)
        g.sircon += Number(r.sircon_fee || 0)
        if (r.state) g.states.add(r.state)
      }
      return [...m.values()]
    }
    return {
      month: make(r => r.date.slice(0, 7), r => r.date.slice(0, 7))
        .sort((a, b) => b.key.localeCompare(a.key)),
      agent: make(r => r.npn || r.producer_name || '(unknown)',
        r => r.producer_name || r.npn || '(unknown)')
        .sort((a, b) => (b.state + b.sircon) - (a.state + a.sircon)),
      service: make(r => r.service_desc || r.service_code || '(unknown)',
        r => r.service_desc || r.service_code || '(unknown)')
        .sort((a, b) => (b.state + b.sircon) - (a.state + a.sircon)),
      state: make(r => r.state || '(none)', r => r.state || '(none)')
        .sort((a, b) => (b.state + b.sircon) - (a.state + a.sircon)),
    }
  }, [filtered])

  const stateOptions = useMemo(() => [...new Set((rows || []).map(r => r.state).filter(Boolean))].sort(), [rows])
  const serviceOptions = useMemo(() => [...new Set((rows || []).map(r => r.service_desc).filter(Boolean))].sort(), [rows])

  function exportXlsx() {
    const wb = XLSX.utils.book_new()
    const aggSheet = (list, label) => {
      const data = list.map(g => ({
        [label]: g.label,
        ...(label === 'Agent' ? { NPN: g.npn || '' } : {}),
        Transactions: g.count,
        States: label === 'Agent' ? [...g.states].sort().join(' ') : undefined,
        'State Fees': +g.state.toFixed(2),
        'Sircon Fees': +g.sircon.toFixed(2),
        Total: +(g.state + g.sircon).toFixed(2),
      }))
      data.push({ [label]: 'TOTAL', Transactions: totals.count,
        'State Fees': +totals.state.toFixed(2), 'Sircon Fees': +totals.sircon.toFixed(2),
        Total: +(totals.state + totals.sircon).toFixed(2) })
      return XLSX.utils.json_to_sheet(data)
    }
    XLSX.utils.book_append_sheet(wb, aggSheet(groups.month, 'Month'), 'By Month')
    XLSX.utils.book_append_sheet(wb, aggSheet(groups.agent, 'Agent'), 'By Agent')
    XLSX.utils.book_append_sheet(wb, aggSheet(groups.service, 'Service'), 'By Service')
    XLSX.utils.book_append_sheet(wb, aggSheet(groups.state, 'State'), 'By State')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtered.map(r => ({
      Date: r.date, Producer: r.producer_name, NPN: r.npn, State: r.state,
      Service: r.service_desc, 'State Fee': Number(r.state_fee || 0),
      'Sircon Fee': Number(r.sircon_fee || 0),
      Total: +(Number(r.state_fee || 0) + Number(r.sircon_fee || 0)).toFixed(2),
      'Confirmation ID': r.confirmation_id, 'Requested By': r.requested_by,
    }))), 'Detail')
    const d = new Date()
    XLSX.writeFile(wb, `Sircon_Costs_${d.getMonth() + 1}.${d.getDate()}.${d.getFullYear()}.xlsx`)
  }

  if (setupNeeded) return (
    <>
      <h1>Licensing Costs</h1>
      <div className="card">
        <h2>One-time setup needed</h2>
        <p>The cost table doesn&apos;t exist yet. Run <code>supabase/costs.sql</code> in the
          Supabase SQL editor (Dashboard → SQL Editor → paste → Run), then reload this page.</p>
      </div>
    </>
  )

  if (!rows) return <><h1>Licensing Costs</h1><div className="card">Loading…</div></>

  const groupRows = groups[breakdown]
  const groupLabel = { month: 'Month', agent: 'Agent', service: 'Service', state: 'State' }[breakdown]
  const detailSlice = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const stat = (label, value) => (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--nsba-navy)' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{label}</div>
    </div>
  )

  return (
    <>
      <h1>Licensing Costs</h1>
      {error && <div className="card" style={{ color: '#991b1b' }}>Error: {error}</div>}

      {isEditor && (
        <div className="card">
          <h2>Import Sircon statements</h2>
          <p style={{ color: '#64748b', fontSize: 13 }}>
            Upload one or more Sircon “Billed Transactions” CSV exports. Overlapping uploads are
            safe — already-recorded transactions are skipped. SSN/EIN columns are never stored.
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <label className="btn btn-secondary">
              {uploading ? 'Importing…' : 'Upload CSV file(s)'}
              <input type="file" accept=".csv" multiple style={{ display: 'none' }} disabled={uploading}
                onChange={e => { upload([...e.target.files]); e.target.value = '' }} />
            </label>
            {uploadMsg && <span style={{ color: '#166534', fontSize: 13 }}>{uploadMsg}</span>}
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={preset} onChange={e => setPreset(e.target.value)}>
            {PRESETS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {preset === 'custom' && (
            <>
              <label style={{ fontSize: 13, color: '#475569' }}>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
              <label style={{ fontSize: 13, color: '#475569' }}>To <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
            </>
          )}
          <input placeholder="Search agent, NPN, requester…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 230 }} />
          <select value={stateF} onChange={e => setStateF(e.target.value)}>
            <option value="">All states</option>
            {stateOptions.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={serviceF} onChange={e => setServiceF(e.target.value)}>
            <option value="">All services</option>
            {serviceOptions.map(s => <option key={s}>{s}</option>)}
          </select>
          <button className="btn" onClick={exportXlsx} disabled={!filtered.length}>
            Download report (.xlsx)
          </button>
        </div>
      </div>

      <div className="grid grid-4">
        {stat('Total spend', fmtMoney(totals.state + totals.sircon))}
        {stat('State fees', fmtMoney(totals.state))}
        {stat('Sircon fees', fmtMoney(totals.sircon))}
        {stat('Transactions', totals.count.toLocaleString())}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Spend breakdown</h2>
          <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
            {BREAKDOWNS.map(([k, v]) => (
              <button key={k} onClick={() => setBreakdown(k)}
                style={{ padding: '6px 12px', border: 0, fontSize: 13,
                  background: breakdown === k ? 'var(--nsba-navy)' : '#fff',
                  color: breakdown === k ? '#fff' : 'var(--nsba-navy)' }}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr>
              <th>{groupLabel}</th>
              {breakdown === 'agent' && <th>NPN</th>}
              {breakdown === 'agent' && <th>States</th>}
              <th>Transactions</th><th>State fees</th><th>Sircon fees</th><th>Total</th>
            </tr></thead>
            <tbody>
              {groupRows.map(g => (
                <tr key={g.key}>
                  <td style={{ fontWeight: 600 }}>
                    {breakdown === 'agent' && g.npn && rosterNpns.has(g.npn)
                      ? <Link to={`/agents/${g.npn}`}>{g.label}</Link> : g.label}
                  </td>
                  {breakdown === 'agent' && <td>{g.npn}</td>}
                  {breakdown === 'agent' && <td style={{ fontSize: 12, maxWidth: 240 }}>{[...g.states].sort().join(' ')}</td>}
                  <td>{g.count}</td>
                  <td>{fmtMoney(g.state)}</td>
                  <td>{fmtMoney(g.sircon)}</td>
                  <td style={{ fontWeight: 600 }}>{fmtMoney(g.state + g.sircon)}</td>
                </tr>
              ))}
              {groupRows.length > 0 && (
                <tr style={{ borderTop: '2px solid var(--line)' }}>
                  <td style={{ fontWeight: 700 }}>Total</td>
                  {breakdown === 'agent' && <td />}
                  {breakdown === 'agent' && <td />}
                  <td style={{ fontWeight: 700 }}>{totals.count}</td>
                  <td style={{ fontWeight: 700 }}>{fmtMoney(totals.state)}</td>
                  <td style={{ fontWeight: 700 }}>{fmtMoney(totals.sircon)}</td>
                  <td style={{ fontWeight: 700 }}>{fmtMoney(totals.state + totals.sircon)}</td>
                </tr>
              )}
              {groupRows.length === 0 && (
                <tr><td colSpan={7} style={{ color: '#64748b' }}>
                  No transactions match{rows.length === 0 && isEditor ? ' — upload Sircon statements above to get started' : ''}.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Transactions ({filtered.length})</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Producer</th><th>NPN</th><th>State</th>
              <th>Service</th><th>State fee</th><th>Sircon fee</th><th>Confirmation</th></tr></thead>
            <tbody>
              {detailSlice.map(r => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.date}</td>
                  <td>
                    {r.npn && rosterNpns.has(r.npn)
                      ? <Link to={`/agents/${r.npn}`}>{r.producer_name}</Link> : r.producer_name}
                    {r.is_firm && <span className="badge badge-warn" style={{ marginLeft: 6 }}>firm</span>}
                  </td>
                  <td>{r.npn}</td>
                  <td>{r.state}</td>
                  <td style={{ fontSize: 12 }}>{r.service_desc}</td>
                  <td>{fmtMoney(Number(r.state_fee || 0))}</td>
                  <td>{fmtMoney(Number(r.sircon_fee || 0))}</td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>{r.confirmation_id}</td>
                </tr>
              ))}
              {detailSlice.length === 0 && (
                <tr><td colSpan={8} style={{ color: '#64748b' }}>No transactions.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} total={filtered.length} perPage={PER_PAGE} onChange={setPage} />
      </div>
    </>
  )
}
