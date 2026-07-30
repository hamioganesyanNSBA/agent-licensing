import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { fetchAll } from '../lib/fetchAll.js'
import { readCsv, toDate, clean } from '../lib/parse.js'
import { toStateCode } from '../lib/states.js'
import { activePlanYear } from '../lib/coverageModel.js'
import { useIsEditor } from '../lib/useIsEditor.js'
import { Th, useSortState, sortCompare } from '../components/SortHeader.jsx'

const EMPTY_FORM = {
  entity: '', state: '', license_number: '', license_type: '', loa: '',
  issue_date: '', expiration_date: '', status: 'Active', notes: '',
}

const COLUMNS = [
  { key: 'entity',          label: 'Entity' },
  { key: 'state',           label: 'State' },
  { key: 'license_number',  label: 'Number' },
  { key: 'license_type',    label: 'Type' },
  { key: 'loa',             label: 'LOA' },
  { key: 'issue_date',      label: 'Issued' },
  { key: 'expiration_date', label: 'Expires' },
  { key: 'status',          label: 'Status' },
]

// Lenient CSV header matching so NIPR-style exports import without fuss.
const HEADER_MAP = [
  ['entity',          /entity|agency|licensee/i],
  ['state',           /^state$|state\s?code|jurisdiction/i],
  ['license_number',  /license\s?(number|#|no)|^number$/i],
  ['license_type',    /type|class/i],
  ['loa',             /loa|line|authority/i],
  ['issue_date',      /issue|effective/i],
  ['expiration_date', /expir/i],
  ['status',          /status/i],
]

export default function AgencyLicenses() {
  const isEditor = useIsEditor()
  const [rows, setRows] = useState(null)
  const [appointments, setAppointments] = useState([])
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [error, setError] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [q, setQ] = useState('')
  const [sort, toggleSort] = useSortState('state')
  const [form, setForm] = useState(null)          // null = closed; {id?} = add/edit
  const [saving, setSaving] = useState(false)
  const [importEntity, setImportEntity] = useState('')
  const [importResult, setImportResult] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const data = await fetchAll('agency_licenses', '*')
      setRows(data)
    } catch (e) {
      if (/does not exist|42P01|schema cache|PGRST205/i.test(e.message || '')) setSetupNeeded(true)
      else setError(e.message || String(e))
      setRows([])
    }
    fetchAll('carrier_appointments', 'state,plan_year,rts_status').then(setAppointments).catch(() => {})
  }

  const entities = useMemo(() => [...new Set((rows || []).map(r => r.entity))].sort(), [rows])

  const today = new Date().toISOString().slice(0, 10)

  // Compliance: states where agents are actively selling (RTS=Y, working plan
  // year) but NO entity holds an active, unexpired agency license.
  const complianceGaps = useMemo(() => {
    if (!rows) return []
    const year = activePlanYear([...new Set(appointments.map(a => a.plan_year))])
    const selling = new Set(appointments.filter(a => a.plan_year === year && a.rts_status === 'Y').map(a => a.state))
    const covered = new Set(rows
      .filter(r => r.status === 'Active' && (!r.expiration_date || r.expiration_date >= today))
      .map(r => r.state))
    return [...selling].filter(s => !covered.has(s)).sort()
  }, [rows, appointments, today])

  const visible = useMemo(() => {
    let out = rows || []
    if (entityFilter) out = out.filter(r => r.entity === entityFilter)
    if (q) {
      const s = q.toLowerCase()
      out = out.filter(r =>
        (r.state || '').toLowerCase().includes(s)
        || (r.license_number || '').toLowerCase().includes(s)
        || (r.entity || '').toLowerCase().includes(s))
    }
    return [...out].sort(sortCompare(sort))
  }, [rows, entityFilter, q, sort])

  function expiryBadge(r) {
    if (r.status !== 'Active') return <span className="badge badge-n">{r.status}</span>
    if (r.expiration_date && r.expiration_date < today) return <span className="badge badge-n">Expired</span>
    if (r.expiration_date) {
      const days = Math.round((new Date(r.expiration_date) - new Date(today)) / 86400000)
      if (days <= 30) return <span className="badge badge-n">Active · {days}d left</span>
      if (days <= 90) return <span className="badge badge-warn">Active · {days}d left</span>
    }
    return <span className="badge badge-y">Active</span>
  }

  async function saveForm() {
    setSaving(true); setError('')
    try {
      const state = toStateCode(form.state)
      if (!form.entity.trim() || !state) throw new Error('Entity and state are required.')
      const payload = {
        entity: form.entity.trim(), state,
        license_number: clean(form.license_number), license_type: clean(form.license_type),
        loa: clean(form.loa),
        issue_date: form.issue_date || null, expiration_date: form.expiration_date || null,
        status: form.status, notes: clean(form.notes), updated_at: new Date().toISOString(),
      }
      const { error: err } = form.id
        ? await supabase.from('agency_licenses').update(payload).eq('id', form.id)
        : await supabase.from('agency_licenses').insert(payload)
      if (err) throw err
      setForm(null)
      await load()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(r) {
    if (!window.confirm(`Delete the ${r.entity} ${r.state} license${r.license_number ? ` (#${r.license_number})` : ''}?`)) return
    const { error: err } = await supabase.from('agency_licenses').delete().eq('id', r.id)
    if (err) setError(err.message)
    else load()
  }

  async function importCsv(file) {
    if (!file) return
    setError(''); setImportResult(null)
    try {
      const raw = await readCsv(file)
      // Find the header row within the first 3 rows (NIPR exports often have a title row).
      let headerIdx = -1
      for (let i = 0; i < Math.min(3, raw.length); i++) {
        const cells = raw[i].map(c => String(c ?? ''))
        if (cells.some(c => /^state$|state\s?code/i.test(c.trim())) && cells.some(c => /license/i.test(c))) { headerIdx = i; break }
      }
      if (headerIdx < 0) throw new Error('Could not find a header row with State and License columns. Nothing was imported.')
      const headers = raw[headerIdx].map(h => String(h ?? '').trim())
      const colFor = {}
      for (const [field, re] of HEADER_MAP) {
        const i = headers.findIndex(h => re.test(h))
        if (i >= 0 && !(field in colFor)) colFor[field] = i
      }
      const out = []
      for (let i = headerIdx + 1; i < raw.length; i++) {
        const r = raw[i]
        const state = toStateCode(r[colFor.state])
        if (!state || state.length !== 2) continue
        const entity = clean(colFor.entity != null ? r[colFor.entity] : null) || importEntity.trim()
        if (!entity) continue
        out.push({
          entity, state,
          license_number: clean(colFor.license_number != null ? r[colFor.license_number] : null),
          license_type:   clean(colFor.license_type != null ? r[colFor.license_type] : null),
          loa:            clean(colFor.loa != null ? r[colFor.loa] : null),
          issue_date:      toDate(colFor.issue_date != null ? r[colFor.issue_date] : null),
          expiration_date: toDate(colFor.expiration_date != null ? r[colFor.expiration_date] : null),
          status: clean(colFor.status != null ? r[colFor.status] : null) || 'Active',
        })
      }
      if (!out.length) throw new Error('No usable rows found. If the file has no Entity column, fill in the entity name next to the upload button.')
      const { error: err } = await supabase.from('agency_licenses').insert(out)
      if (err) throw err
      setImportResult(out.length)
      await load()
    } catch (e) {
      setError(e.message || String(e))
    }
  }

  if (setupNeeded) return (
    <>
      <h1>Agency Licenses</h1>
      <div className="card">
        <h2>One-time setup needed</h2>
        <p>The agency license table doesn&apos;t exist yet. Run <code>supabase/agency.sql</code> in the
          Supabase SQL editor (Dashboard → SQL Editor → paste → Run), then reload this page.</p>
      </div>
    </>
  )

  if (!rows) return <><h1>Agency Licenses</h1><div className="card">Loading…</div></>

  return (
    <>
      <h1>Agency Licenses</h1>
      {error && <div className="card" style={{ color: '#991b1b' }}>Error: {error}</div>}

      {complianceGaps.length > 0 && (
        <div className="card" style={{ borderColor: '#b91c1c', background: '#fff1f2' }}>
          <h2 style={{ color: '#b91c1c' }}>⚠ Compliance check — {complianceGaps.length} state(s) with selling agents but no active agency license</h2>
          <p style={{ fontSize: 13, color: '#7f1d1d', marginBottom: 8 }}>
            Agents are RTS with at least one carrier in these states, but no entity holds an active, unexpired agency license there:
          </p>
          <div>{complianceGaps.map(s => <span key={s} className="badge badge-n" style={{ marginRight: 4 }}>{s}</span>)}</div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <select value={entityFilter} onChange={e => setEntityFilter(e.target.value)}>
            <option value="">All entities</option>
            {entities.map(e => <option key={e}>{e}</option>)}
          </select>
          <input placeholder="Search state, number, entity…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 240 }} />
          <span style={{ color: '#64748b', fontSize: 13 }}>{visible.length} licenses</span>
          {isEditor && (
            <button className="btn" onClick={() => setForm({ ...EMPTY_FORM, entity: entityFilter || entities[0] || '' })}>
              + Add license
            </button>
          )}
        </div>

        {isEditor && form && (
          <div style={{ padding: 12, marginBottom: 12, border: '1px solid var(--line)', borderRadius: 8, background: '#f8fafc' }}>
            <h2>{form.id ? 'Edit license' : 'Add license'}</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input placeholder="Entity (e.g. NSBA)" value={form.entity} onChange={e => setForm(f => ({ ...f, entity: e.target.value }))} style={{ width: 180 }} />
              <input placeholder="State" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value.toUpperCase() }))} style={{ width: 80 }} />
              <input placeholder="License number" value={form.license_number} onChange={e => setForm(f => ({ ...f, license_number: e.target.value }))} style={{ width: 150 }} />
              <input placeholder="Type / class" value={form.license_type} onChange={e => setForm(f => ({ ...f, license_type: e.target.value }))} style={{ width: 170 }} />
              <input placeholder="LOA" value={form.loa} onChange={e => setForm(f => ({ ...f, loa: e.target.value }))} style={{ width: 150 }} />
              <label style={{ fontSize: 13, color: '#475569' }}>Issued <input type="date" value={form.issue_date || ''} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} /></label>
              <label style={{ fontSize: 13, color: '#475569' }}>Expires <input type="date" value={form.expiration_date || ''} onChange={e => setForm(f => ({ ...f, expiration_date: e.target.value }))} /></label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option>Active</option><option>Inactive</option>
              </select>
              <input placeholder="Notes" value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ width: 220 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn" disabled={saving} onClick={saveForm}>{saving ? 'Saving…' : 'Save'}</button>
              <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {COLUMNS.map(c => <Th key={c.key} col={c} sort={sort} onToggle={toggleSort} />)}
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.entity}</td>
                  <td>{r.state}</td>
                  <td>{r.license_number}</td>
                  <td>{r.license_type}</td>
                  <td>{r.loa}</td>
                  <td>{r.issue_date}</td>
                  <td>{r.expiration_date}</td>
                  <td>{expiryBadge(r)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {isEditor && (
                      <>
                        <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12, marginRight: 4 }}
                          onClick={() => setForm({ ...EMPTY_FORM, ...r })}>Edit</button>
                        <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }}
                          onClick={() => remove(r)}>✕</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={9} style={{ color: '#64748b' }}>No agency licenses yet{isEditor ? ' — add one above or import a CSV below.' : '.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isEditor && (
        <div className="card">
          <h2>Import from CSV</h2>
          <p style={{ color: '#64748b', fontSize: 13 }}>
            Upload a NIPR-style CSV of the agency&apos;s licenses (columns like State, License Number,
            Type/Class, LOA, Issue Date, Expiration Date, Status). If the file has no Entity column,
            enter the entity name here first — it will be applied to every row. Rows are added, not
            replaced; delete mistakes from the table above.
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input placeholder="Entity for this file (e.g. NSBA)" value={importEntity} onChange={e => setImportEntity(e.target.value)} style={{ width: 220 }} />
            <label className="btn btn-secondary">
              Upload CSV
              <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { importCsv(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            {importResult != null && <span style={{ color: '#166534', fontSize: 13 }}>Imported {importResult} license(s).</span>}
          </div>
        </div>
      )}
    </>
  )
}
