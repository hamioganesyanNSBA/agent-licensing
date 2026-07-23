import { useState, useEffect, useCallback } from 'react'
import { useUser } from '@clerk/clerk-react'
import { IMPORTERS, IMPORTER_LIST } from '../lib/importers/index.js'
import { supabase } from '../lib/supabase.js'
import { fetchAll } from '../lib/fetchAll.js'
import { autoConfirmRts } from '../lib/releases.js'

// Compare parsed appointment rows against what's already stored for the same
// carrier(s) + plan year(s), BEFORE upserting — so each import shows exactly
// what changed: new appointments, RTS flips, and rows absent from the file.
async function computeApptDiff(appointments) {
  const carriers = [...new Set(appointments.map(a => a.carrier))]
  const years = new Set(appointments.map(a => a.plan_year))
  let existing = []
  for (const c of carriers) {
    const rows = await fetchAll('carrier_appointments',
      'id,agent_npn,first_name,last_name,carrier,plan_year,state,product_category,rts_status',
      { eq: { carrier: c } })
    existing = existing.concat(rows.filter(r => years.has(r.plan_year)))
  }
  const key = a => `${a.agent_npn}|${a.carrier}|${a.plan_year}|${a.state}|${a.product_category}`
  const oldMap = new Map(existing.map(r => [key(r), r]))
  const gained = [], lost = [], added = [], missing = []
  let unchanged = 0
  const seen = new Set()
  for (const row of appointments) {
    const k = key(row)
    seen.add(k)
    const old = oldMap.get(k)
    if (!old) added.push(row)
    else if (old.rts_status !== row.rts_status) (row.rts_status === 'Y' ? gained : lost).push(row)
    else unchanged++
  }
  for (const [k, row] of oldMap) if (!seen.has(k)) missing.push(row)
  return { gained, lost, added, missing, unchanged }
}

function groupByAgent(rows) {
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r.agent_npn)) {
      const name = `${r.last_name || ''}, ${r.first_name || ''}`.replace(/^, |, $/g, '')
      m.set(r.agent_npn, { npn: r.agent_npn, name: name || r.agent_npn, states: new Set() })
    }
    m.get(r.agent_npn).states.add(r.state)
  }
  return [...m.values()]
    .map(g => ({ ...g, states: [...g.states].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export default function Imports() {
  const { user } = useUser()
  const [importerKey, setImporterKey] = useState(IMPORTER_LIST[0]?.key || '')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [clearing, setClearing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [lastSync, setLastSync] = useState(null)

  const importer = IMPORTERS[importerKey]

  const loadLastSync = useCallback(async () => {
    const { data } = await supabase
      .from('import_runs')
      .select('imported_at, row_count, imported_by')
      .eq('source', 'onyx')
      .order('imported_at', { ascending: false })
      .limit(1)
    setLastSync(data?.[0] || null)
  }, [])

  useEffect(() => { loadLastSync() }, [loadLastSync])

  async function run() {
    if (!file || !importer) return
    setBusy(true); setError(''); setResult(null)
    try {
      const parsed = await importer.parseFile(file)

      if (parsed.agents?.length) {
        const chunks = chunk(parsed.agents, 500)
        for (const c of chunks) {
          const { error } = await supabase.from('agents').upsert(c, { onConflict: 'npn' })
          if (error) throw error
        }
      }

      if (parsed.licenses?.length) {
        const chunks = chunk(parsed.licenses, 500)
        for (const c of chunks) {
          const { error } = await supabase
            .from('licenses')
            .upsert(c, { onConflict: 'npn,state,license_number,loa' })
          if (error) throw error
        }
      }

      let diff = null
      if (parsed.appointments?.length) {
        // Diff against current data BEFORE writing, so the change report is real.
        diff = await computeApptDiff(parsed.appointments)
        // NOTE: appointment imports intentionally do NOT touch the agents
        // table — the roster (names + emails) is owned by the Onyx sync, and
        // carrier files carry no email, so upserting here would clobber the
        // synced emails with null (and resurrect departed agents).
        const apptChunks = chunk(parsed.appointments.map(a => ({
          ...a, source_file: file.name,
        })), 500)
        for (const c of apptChunks) {
          const { error } = await supabase
            .from('carrier_appointments')
            .upsert(c, { onConflict: 'agent_npn,carrier,plan_year,state,product_category' })
          if (error) throw error
        }
      }

      // Fresh RTS data may satisfy open release workflows — auto-confirm them.
      const auto = parsed.appointments?.length ? await autoConfirmRts() : { confirmed: 0, completed: 0 }

      const counts = {
        agents:       parsed.agents?.length       || 0,
        licenses:     parsed.licenses?.length     || 0,
        appointments: parsed.appointments?.length || 0,
        unmatched:    parsed.unmatched || null,
        autoConfirmed: auto.confirmed,
        autoCompleted: auto.completed,
        diff,
      }
      const total = counts.agents + counts.licenses + counts.appointments
      const { data: runRow } = await supabase.from('import_runs').insert({
        source: importerKey,
        filename: file.name,
        row_count: total,
        imported_by: user?.primaryEmailAddress?.emailAddress || null,
        notes: diff
          ? `+${diff.added.length} new, ${diff.gained.length} gained RTS, ${diff.lost.length} lost RTS, `
            + `${diff.missing.length} not in file, ${diff.unchanged} unchanged`
          : null,
      }).select('id,notes').single()
      setResult({ ...counts, runId: runRow?.id, runNotes: runRow?.notes })
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function syncOnyx() {
    setSyncing(true); setError(''); setSyncResult(null)
    try {
      const res = await fetch('/api/sync-licenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imported_by: user?.primaryEmailAddress?.emailAddress || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Sync failed (${res.status})`)
      setSyncResult(data)
      loadLastSync()
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    } finally {
      setSyncing(false)
    }
  }

  async function removeMissing() {
    const missing = result?.diff?.missing || []
    if (!missing.length) return
    if (!window.confirm(
      `Delete ${missing.length} appointment row(s) that no longer appear in the carrier's report? `
      + `They will disappear from the Appointments page, Coverage, and the Sunfire export. This cannot be undone.`)) return
    setBusy(true); setError('')
    try {
      for (const c of chunk(missing.map(m => m.id).filter(Boolean), 200)) {
        const { error } = await supabase.from('carrier_appointments').delete().in('id', c)
        if (error) throw error
      }
      if (result.runId) {
        await supabase.from('import_runs')
          .update({ notes: `${result.runNotes || ''} — ${missing.length} stale row(s) removed` })
          .eq('id', result.runId)
      }
      setResult(r => ({ ...r, diff: { ...r.diff, missing: [], missingRemoved: missing.length } }))
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function clearAll() {
    if (!window.confirm('This will delete ALL data from every table (licenses, appointments, agents, import history). Are you sure?')) return
    setClearing(true); setError('')
    try {
      // Delete in order respecting any potential FK relationships
      await supabase.from('carrier_appointments').delete().gte('id', 0)
      await supabase.from('licenses').delete().gte('id', 0)
      await supabase.from('import_runs').delete().gte('id', 0)
      await supabase.from('agents').delete().neq('npn', '')
      setResult(null)
      alert('All data cleared. You can now re-import your files.')
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    } finally {
      setClearing(false)
    }
  }

  return (
    <>
      <h1>Imports</h1>
      <div className="card">
        <h2>Sync licenses from Onyx</h2>
        <p style={{ color: '#64748b', fontSize: 13 }}>
          Pulls every agent's current licenses straight from Onyx and mirrors them into the
          Licenses table — no file needed. Onyx refreshes from NIPR daily, so running this once
          a day keeps you current.
        </p>
        <button className="btn" disabled={syncing} onClick={syncOnyx}>
          {syncing ? 'Syncing…' : 'Sync from Onyx'}
        </button>
        <div style={{ color: '#64748b', fontSize: 13, marginTop: 8 }}>
          {lastSync
            ? `Last synced ${formatWhen(lastSync.imported_at)} · ${lastSync.row_count ?? 0} licenses${lastSync.imported_by ? ` · by ${lastSync.imported_by}` : ' · by daily cron'}`
            : 'Never synced yet.'}
        </div>
        {syncResult && (
          <div style={{ color: '#166534', marginTop: 8 }}>
            Synced — {syncResult.agents} agents, {syncResult.licenses} licenses
            {syncResult.detail_failures ? `, ${syncResult.detail_failures} agents skipped (fetch error)` : ''}
            {syncResult.pruned_agents ? `; removed ${syncResult.pruned_agents} departed agent(s)` : ''}.
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Import a file</h2>
        <p>Upload a source file. Existing rows will be updated (upsert).</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <select value={importerKey} onChange={e => { setImporterKey(e.target.value); setFile(null); setResult(null) }}>
            {IMPORTER_LIST.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <input
            type="file"
            accept={importer.meta.accept}
            onChange={e => setFile(e.target.files?.[0] || null)}
          />
          <button className="btn" disabled={!file || busy} onClick={run}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
        {error  && <div style={{ color: '#991b1b' }}>Error: {error}</div>}
        {result && (
          <div style={{ color: '#166534' }}>
            Imported — agents: {result.agents}, licenses: {result.licenses}, appointments: {result.appointments}
            {result.autoConfirmed > 0 && (
              <div style={{ marginTop: 4, fontSize: 13 }}>
                ⚡ Auto-confirmed {result.autoConfirmed} release step(s)
                {result.autoCompleted > 0 ? ` — ${result.autoCompleted} release workflow(s) completed` : ''} based on this RTS data.
              </div>
            )}
            {result.unmatched?.length > 0 && (
              <div style={{ color: '#92400e', marginTop: 8, fontSize: 13 }}>
                {result.unmatched.length} writing name(s) skipped — no matching active agent:
                <div style={{ marginTop: 4, color: '#64748b' }}>{result.unmatched.join(', ')}</div>
              </div>
            )}
          </div>
        )}
        {result?.diff && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: 15, color: 'var(--nsba-navy)', margin: '0 0 4px' }}>Changes in this import</h2>
            <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
              Compared against what the app had for this carrier before the upload · {result.diff.unchanged} rows unchanged
            </p>
            <ChangeSection title="Gained RTS (N → Y)" rows={result.diff.gained} color="#166534" open />
            <ChangeSection title="Lost RTS (Y → N)" rows={result.diff.lost} color="#991b1b" open />
            <ChangeSection title="New appointments (not in app before)" rows={result.diff.added} color="#14266b" />
            <ChangeSection title="In app but missing from this file" rows={result.diff.missing} color="#92400e" />
            {result.diff.missing.length > 0 && (
              <button className="btn btn-danger" style={{ marginTop: 4, padding: '6px 12px', fontSize: 13 }}
                disabled={busy} onClick={removeMissing}>
                Remove these {result.diff.missing.length} stale row(s) from the app
              </button>
            )}
            {result.diff.missingRemoved > 0 && (
              <div style={{ color: '#166534', fontSize: 13, marginTop: 4 }}>
                🗑 {result.diff.missingRemoved} stale row(s) removed — Appointments, Coverage, and the Sunfire export now match this report.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>Clear All Data</h2>
        <p style={{ color: '#64748b', fontSize: 13 }}>Delete all records from every table so you can start fresh. This cannot be undone.</p>
        <button className="btn btn-danger" disabled={clearing} onClick={clearAll}>
          {clearing ? 'Clearing…' : 'Clear All Data'}
        </button>
      </div>
    </>
  )
}

function ChangeSection({ title, rows, color, open }) {
  const groups = groupByAgent(rows)
  return (
    <details open={open && rows.length > 0} style={{ marginBottom: 8 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: rows.length ? color : '#94a3b8' }}>
        {title} — {rows.length === 0 ? 'none' : `${rows.length} row(s), ${groups.length} agent(s)`}
      </summary>
      {groups.length > 0 && (
        <div style={{ margin: '6px 0 4px 16px', maxHeight: 260, overflowY: 'auto', fontSize: 13 }}>
          {groups.map(g => (
            <div key={g.npn} style={{ padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>
              <strong>{g.name}</strong> <span style={{ color: '#94a3b8' }}>({g.npn})</span>
              <span style={{ color: '#64748b' }}> — {g.states.join(', ')}</span>
            </div>
          ))}
        </div>
      )}
    </details>
  )
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function formatWhen(ts) {
  const d = new Date(ts)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  return d.toLocaleString()
}
