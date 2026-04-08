import { useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { IMPORTERS, IMPORTER_LIST } from '../lib/importers/index.js'
import { supabase } from '../lib/supabase.js'

export default function Imports() {
  const { user } = useUser()
  const [importerKey, setImporterKey] = useState('licenses')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const importer = IMPORTERS[importerKey]

  async function run() {
    if (!file || !importer) return
    setBusy(true); setError(''); setResult(null)
    try {
      const parsed = await importer.parseFile(file)

      // Upsert agents (if importer returned them).
      if (parsed.agents?.length) {
        const chunks = chunk(parsed.agents, 500)
        for (const c of chunks) {
          const { error } = await supabase.from('agents').upsert(c, { onConflict: 'npn' })
          if (error) throw error
        }
      }

      // Upsert licenses.
      if (parsed.licenses?.length) {
        const chunks = chunk(parsed.licenses, 500)
        for (const c of chunks) {
          const { error } = await supabase
            .from('licenses')
            .upsert(c, { onConflict: 'npn,state,license_number,loa' })
          if (error) throw error
        }
      }

      // Upsert appointments. Also upsert any agents we learned about.
      if (parsed.appointments?.length) {
        const agentMap = new Map()
        for (const a of parsed.appointments) {
          if (a.agent_npn && !agentMap.has(a.agent_npn)) {
            agentMap.set(a.agent_npn, {
              npn:        a.agent_npn,
              first_name: a.first_name,
              last_name:  a.last_name,
              email:      a.email,
            })
          }
        }
        const agentChunks = chunk([...agentMap.values()], 500)
        for (const c of agentChunks) {
          const { error } = await supabase.from('agents').upsert(c, { onConflict: 'npn' })
          if (error) throw error
        }
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

      const counts = {
        agents:       parsed.agents?.length       || 0,
        licenses:     parsed.licenses?.length     || 0,
        appointments: parsed.appointments?.length || 0,
      }
      const total = counts.agents + counts.licenses + counts.appointments
      await supabase.from('import_runs').insert({
        source: importerKey,
        filename: file.name,
        row_count: total,
        imported_by: user?.primaryEmailAddress?.emailAddress || null,
      })
      setResult(counts)
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Imports</h1>
      <div className="card">
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
          </div>
        )}
      </div>
    </>
  )
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
