import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { RELEASE_CARRIERS, computeProgress, isComplete, fmtTs } from '../lib/releases.js'
import ProgressBar from '../components/ProgressBar.jsx'

const STATUS_BADGE = {
  in_progress: ['badge-warn', 'In progress'],
  completed:   ['badge-y', 'Completed'],
  cancelled:   ['badge-n', 'Cancelled'],
}

const DOC_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png'

export default function ReleaseDetail() {
  const { id } = useParams()
  const [wf, setWf] = useState(null)
  const [carriers, setCarriers] = useState([])
  const [rtsCarriers, setRtsCarriers] = useState(new Set())  // carriers where RTS reports already show Y
  const [notes, setNotes] = useState('')
  const [notesSaved, setNotesSaved] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [addCarrier, setAddCarrier] = useState('')

  useEffect(() => { load() }, [id])

  async function load() {
    const { data: w } = await supabase.from('release_workflows').select('*').eq('id', id).single()
    const { data: cs } = await supabase.from('release_carriers').select('*').eq('workflow_id', id).order('carrier')
    setWf(w); setCarriers(cs || []); setNotes(w?.notes || '')
    if (w) {
      // RTS hint: does the agent already show RTS=Y in our imported reports?
      const { data: appts } = await supabase.from('carrier_appointments')
        .select('carrier,plan_year').eq('agent_npn', w.agent_npn).eq('rts_status', 'Y').limit(5000)
      const latest = Math.max(...(appts || []).map(a => a.plan_year || 0), 0)
      setRtsCarriers(new Set((appts || []).filter(a => a.plan_year === latest).map(a => a.carrier)))
    }
  }

  // Keep status/completed_at in sync after any change.
  async function syncStatus(nextWf, nextCarriers) {
    const complete = isComplete(nextWf, nextCarriers)
    if (complete && nextWf.status === 'in_progress') {
      const completed_at = new Date().toISOString()
      await supabase.from('release_workflows').update({ status: 'completed', completed_at }).eq('id', id)
      setWf(w => ({ ...w, status: 'completed', completed_at }))
    } else if (!complete && nextWf.status === 'completed') {
      await supabase.from('release_workflows').update({ status: 'in_progress', completed_at: null }).eq('id', id)
      setWf(w => ({ ...w, status: 'in_progress', completed_at: null }))
    }
  }

  async function uploadDoc(kind, file) {
    if (!file) return
    setBusy(true); setError('')
    try {
      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
      const path = `wf-${id}/${kind}${ext}`
      const { error: upErr } = await supabase.storage.from('releases').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const ts = new Date().toISOString()
      const patch = kind === 'release-letter'
        ? { release_letter_path: path, release_letter_uploaded_at: ts }
        : { aetna_hierarchy_path: path, aetna_hierarchy_uploaded_at: ts }
      const { error: dbErr } = await supabase.from('release_workflows').update(patch).eq('id', id)
      if (dbErr) throw dbErr
      const nextWf = { ...wf, ...patch }
      setWf(nextWf)
      await syncStatus(nextWf, carriers)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function setStep(carrierRow, field, value) {
    setError('')
    const patch = { [field]: value }
    const { error: err } = await supabase.from('release_carriers').update(patch).eq('id', carrierRow.id)
    if (err) { setError(err.message); return }
    const nextCarriers = carriers.map(c => c.id === carrierRow.id ? { ...c, ...patch } : c)
    setCarriers(nextCarriers)
    await syncStatus(wf, nextCarriers)
  }

  async function saveNotes() {
    await supabase.from('release_workflows').update({ notes }).eq('id', id)
    setNotesSaved(true)
  }

  async function setWfStatus(status) {
    const patch = { status, completed_at: status === 'completed' ? new Date().toISOString() : null }
    await supabase.from('release_workflows').update(patch).eq('id', id)
    setWf(w => ({ ...w, ...patch }))
  }

  async function addCarrierRow() {
    if (!addCarrier) return
    const { data, error: err } = await supabase.from('release_carriers')
      .insert({ workflow_id: Number(id), carrier: addCarrier }).select('*').single()
    if (err) { setError(err.message); return }
    const nextCarriers = [...carriers, data].sort((a, b) => a.carrier.localeCompare(b.carrier))
    setCarriers(nextCarriers)
    setAddCarrier('')
    await syncStatus(wf, nextCarriers)
  }

  async function removeCarrierRow(c) {
    if (c.sent_at || c.approved_at || c.rts_confirmed_at) return
    if (!window.confirm(`Remove ${c.carrier} from this release?`)) return
    await supabase.from('release_carriers').delete().eq('id', c.id)
    const nextCarriers = carriers.filter(x => x.id !== c.id)
    setCarriers(nextCarriers)
    await syncStatus(wf, nextCarriers)
  }

  const progress = useMemo(() => wf ? computeProgress(wf, carriers) : null, [wf, carriers])

  if (!wf) return <><h1>Release</h1><div className="card">Loading…</div></>

  const hasAetna = carriers.some(c => c.carrier === 'Aetna')
  const [statusCls, statusLabel] = STATUS_BADGE[wf.status] || ['badge-warn', wf.status]
  const docUrl = (path) => supabase.storage.from('releases').getPublicUrl(path).data.publicUrl
  const availableToAdd = RELEASE_CARRIERS.filter(c => !carriers.some(x => x.carrier === c))

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 8 }}>Release · {wf.agent_name}</h1>
        <span className={`badge ${statusCls}`}>{statusLabel}</span>
        <Link to="/releases" style={{ fontSize: 13 }}>← All releases</Link>
      </div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        NPN {wf.agent_npn} · started {fmtTs(wf.created_at)}{wf.created_by ? ` by ${wf.created_by}` : ''}
        {wf.completed_at ? ` · completed ${fmtTs(wf.completed_at)}` : ''}
      </p>

      <div className="card">
        <ProgressBar value={progress.pct} label={`${progress.done} of ${progress.total} tasks · ${Math.round(progress.pct * 100)}%`} height={14} />
      </div>

      {error && <div className="card" style={{ color: '#991b1b' }}>Error: {error}</div>}

      <div className="card">
        <h2>Step 1 · Release documents</h2>
        <DocRow
          label="Release letter from the agent"
          path={wf.release_letter_path} uploadedAt={wf.release_letter_uploaded_at}
          busy={busy} docUrl={docUrl}
          onUpload={f => uploadDoc('release-letter', f)} />
        {hasAetna && (
          <DocRow
            label="Aetna Hierarchy Change Request form"
            path={wf.aetna_hierarchy_path} uploadedAt={wf.aetna_hierarchy_uploaded_at}
            busy={busy} docUrl={docUrl}
            onUpload={f => uploadDoc('aetna-hierarchy', f)} />
        )}
      </div>

      <div className="card">
        <h2>Step 2 · Carrier progress</h2>
        <p style={{ color: '#64748b', fontSize: 13 }}>
          Each carrier moves through: release sent → contract approved → confirmed in RTS reports.
          Every action is timestamped. Click a completed step to undo it (in reverse order only).
        </p>
        <table>
          <thead><tr><th>Carrier</th><th>Release sent</th><th>Contract approved</th><th>Confirmed in RTS report</th><th /></tr></thead>
          <tbody>
            {carriers.map(c => {
              const docsReady = !!wf.release_letter_uploaded_at && (c.carrier !== 'Aetna' || !!wf.aetna_hierarchy_uploaded_at)
              return (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c.carrier}</td>
                  <StepCell ts={c.sent_at}
                    canDo={docsReady}
                    gate={c.carrier === 'Aetna' && !wf.aetna_hierarchy_uploaded_at
                      ? 'Upload the release letter and the Aetna Hierarchy Change Request form first'
                      : 'Upload the release letter first'}
                    canUndo={!c.approved_at}
                    onMark={() => setStep(c, 'sent_at', new Date().toISOString())}
                    onClear={() => setStep(c, 'sent_at', null)} />
                  <StepCell ts={c.approved_at}
                    canDo={!!c.sent_at} gate="Mark the release as sent first"
                    canUndo={!c.rts_confirmed_at}
                    onMark={() => setStep(c, 'approved_at', new Date().toISOString())}
                    onClear={() => setStep(c, 'approved_at', null)} />
                  <StepCell ts={c.rts_confirmed_at}
                    canDo={!!c.approved_at} gate="Mark the contract as approved first"
                    canUndo
                    hint={rtsCarriers.has(c.carrier) && !c.rts_confirmed_at
                      ? <div style={{ fontSize: 11, color: '#166534', marginTop: 4 }}>✓ already showing RTS in our reports</div>
                      : null}
                    onMark={() => setStep(c, 'rts_confirmed_at', new Date().toISOString())}
                    onClear={() => setStep(c, 'rts_confirmed_at', null)} />
                  <td>
                    {!c.sent_at && !c.approved_at && !c.rts_confirmed_at && (
                      <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }}
                        onClick={() => removeCarrierRow(c)} title="Remove carrier from this release">✕</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {availableToAdd.length > 0 && wf.status !== 'completed' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <select value={addCarrier} onChange={e => setAddCarrier(e.target.value)}>
              <option value="">Add a carrier…</option>
              {availableToAdd.map(c => <option key={c}>{c}</option>)}
            </select>
            <button className="btn btn-secondary" disabled={!addCarrier} onClick={addCarrierRow}>Add</button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Notes</h2>
        <textarea value={notes} rows={4}
          onChange={e => { setNotes(e.target.value); setNotesSaved(false) }}
          onBlur={saveNotes}
          style={{ width: '100%', padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, font: 'inherit' }}
          placeholder="Anything worth tracking — carrier contacts, ticket numbers, follow-up dates…" />
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{notesSaved ? 'Saved' : 'Unsaved — click away to save'}</div>
      </div>

      <div className="card">
        {wf.status === 'cancelled'
          ? <button className="btn" onClick={() => setWfStatus('in_progress')}>Reopen workflow</button>
          : wf.status === 'in_progress'
            ? <button className="btn btn-danger" onClick={() => { if (window.confirm('Cancel this release workflow?')) setWfStatus('cancelled') }}>Cancel workflow</button>
            : <span style={{ color: '#166534', fontWeight: 600 }}>🎉 Release complete — all carriers confirmed in RTS reports.</span>}
      </div>
    </>
  )
}

function DocRow({ label, path, uploadedAt, busy, docUrl, onUpload }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #eef2f7', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 280, fontWeight: 600 }}>{label}</div>
      {uploadedAt ? (
        <>
          <span className="badge badge-y">✓ uploaded {fmtTs(uploadedAt)}</span>
          <a href={docUrl(path)} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>View document</a>
          <label style={{ fontSize: 13, color: '#64748b', cursor: 'pointer', textDecoration: 'underline' }}>
            replace
            <input type="file" accept={DOC_ACCEPT} style={{ display: 'none' }} disabled={busy}
              onChange={e => onUpload(e.target.files?.[0])} />
          </label>
        </>
      ) : (
        <label className="btn btn-secondary" style={{ display: 'inline-block' }}>
          {busy ? 'Uploading…' : 'Upload file'}
          <input type="file" accept={DOC_ACCEPT} style={{ display: 'none' }} disabled={busy}
            onChange={e => onUpload(e.target.files?.[0])} />
        </label>
      )}
    </div>
  )
}

function StepCell({ ts, canDo, gate, canUndo, onMark, onClear, hint }) {
  if (ts) return (
    <td>
      <span className="badge badge-y" title={canUndo ? 'Click ✕ to undo' : 'Undo later steps first'}>✓ {fmtTs(ts)}</span>
      {canUndo && (
        <button onClick={() => { if (window.confirm('Undo this step?')) onClear() }}
          style={{ border: 0, background: 'none', color: '#94a3b8', fontSize: 12, marginLeft: 6 }}
          title="Undo">✕</button>
      )}
    </td>
  )
  return (
    <td>
      <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 13 }}
        disabled={!canDo} title={canDo ? '' : gate} onClick={onMark}>
        Mark done
      </button>
      {hint}
    </td>
  )
}
