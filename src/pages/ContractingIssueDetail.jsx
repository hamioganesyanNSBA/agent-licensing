import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { supabase } from '../lib/supabase.js'
import { useIsEditor } from '../lib/useIsEditor.js'
import { REASONS, STATUS, TRANSITIONS, isOpen, fmtTs, addNote, setStatus } from '../lib/contracting.js'

export default function ContractingIssueDetail() {
  const { id } = useParams()
  const { user } = useUser()
  const isEditor = useIsEditor()
  const author = user?.primaryEmailAddress?.emailAddress || null

  const [issue, setIssue] = useState(null)
  const [notes, setNotes] = useState([])
  const [siblings, setSiblings] = useState([])   // the agent's other cases
  const [noteText, setNoteText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editingReason, setEditingReason] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonDetail, setReasonDetail] = useState('')

  useEffect(() => { load() }, [id])

  async function load() {
    const { data: i, error: e1 } = await supabase.from('contracting_issues').select('*').eq('id', id).single()
    if (e1) { setError(e1.message); return }
    const [{ data: ns }, { data: sib }] = await Promise.all([
      supabase.from('contracting_issue_notes').select('*').eq('issue_id', id).order('created_at'),
      supabase.from('contracting_issues').select('id,carrier,status').eq('agent_npn', i.agent_npn).neq('id', id).order('carrier'),
    ])
    setIssue(i); setNotes(ns || []); setSiblings(sib || [])
    setReason(i.reason || ''); setReasonDetail(i.reason_detail || '')
  }

  async function changeStatus(next) {
    const closing = !STATUS[next].open
    let why = ''
    if (closing) {
      const label = STATUS[next].label.toLowerCase()
      why = window.prompt(`Mark this case ${label}? Add a short note (optional):`)
      if (why === null) return
    } else if (!window.confirm(`Move this case to ${STATUS[next].label}?`)) return
    setBusy(true); setError('')
    try {
      const patch = await setStatus(issue, next, author, why || '')
      setIssue(i => ({ ...i, ...patch }))
      const { data: ns } = await supabase.from('contracting_issue_notes').select('*').eq('issue_id', id).order('created_at')
      setNotes(ns || [])
    } catch (e) { setError(e.message || String(e)) }
    finally { setBusy(false) }
  }

  async function postNote() {
    const body = noteText.trim()
    if (!body) return
    setBusy(true); setError('')
    try {
      const n = await addNote(Number(id), body, author, false)
      setNotes(ns => [...ns, n])
      setIssue(i => ({ ...i, updated_at: n.created_at }))
      setNoteText('')
    } catch (e) { setError(e.message || String(e)) }
    finally { setBusy(false) }
  }

  async function saveReason() {
    const patch = { reason: reason || null, reason_detail: reasonDetail || null, updated_at: new Date().toISOString() }
    const { error: e } = await supabase.from('contracting_issues').update(patch).eq('id', id)
    if (e) { setError(e.message); return }
    setIssue(i => ({ ...i, ...patch }))
    setEditingReason(false)
  }

  async function deleteNote(n) {
    if (!window.confirm('Delete this note?')) return
    const { error: e } = await supabase.from('contracting_issue_notes').delete().eq('id', n.id)
    if (e) { setError(e.message); return }
    setNotes(ns => ns.filter(x => x.id !== n.id))
  }

  if (error && !issue) return <><h1>Contracting issue</h1><div className="card" style={{ color: '#991b1b' }}>Error: {error}</div></>
  if (!issue) return <><h1>Contracting issue</h1><div className="card">Loading…</div></>

  const st = STATUS[issue.status] || { label: issue.status, badge: 'badge-warn' }
  const transitions = TRANSITIONS[issue.status] || []
  const BUTTON_STYLE = {
    resubmitted:        'btn',
    pending:            'btn btn-secondary',
    approved:           'btn',
    unable_to_contract: 'btn btn-danger',
  }
  const BUTTON_LABEL = {
    resubmitted:        'Mark resubmitted',
    pending:            isOpen(issue) ? 'Back to pending' : 'Reopen (pending)',
    approved:           'Approved ✓',
    unable_to_contract: 'Unable to contract',
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 8 }}>{issue.carrier} · {issue.agent_name}</h1>
        <span className={`badge ${st.badge}`}>{st.label}</span>
        <Link to="/contracting" style={{ fontSize: 13 }}>← All contracting issues</Link>
      </div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>
        <Link to={`/agents/${issue.agent_npn}`}>NPN {issue.agent_npn}</Link>
        {' '}· opened {fmtTs(issue.opened_at)}{issue.created_by ? ` by ${issue.created_by}` : ''}
        {issue.resubmitted_at ? ` · last resubmitted ${fmtTs(issue.resubmitted_at)}` : ''}
        {issue.closed_at ? ` · closed ${fmtTs(issue.closed_at)}` : ''}
      </p>

      {error && <div className="card" style={{ color: '#991b1b' }}>Error: {error}</div>}

      <div className="card">
        <h2>Issue</h2>
        {editingReason ? (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">— reason —</option>
              {REASONS.map(r => <option key={r}>{r}</option>)}
            </select>
            <input value={reasonDetail} onChange={e => setReasonDetail(e.target.value)} placeholder="Details" style={{ flex: 1, minWidth: 300 }} />
            <button className="btn" onClick={saveReason}>Save</button>
            <button className="btn btn-secondary" onClick={() => { setEditingReason(false); setReason(issue.reason || ''); setReasonDetail(issue.reason_detail || '') }}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>{issue.reason || 'No reason recorded'}</span>
            {issue.reason_detail && <span style={{ color: '#475569' }}>{issue.reason_detail}</span>}
            {isEditor && <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setEditingReason(true)}>Edit</button>}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Status</h2>
        <p style={{ color: '#64748b', fontSize: 13 }}>
          <strong>Pending</strong> = waiting on the carrier or the agent. <strong>Resubmitted</strong> = corrected paperwork
          sent back to the carrier. <strong>Approved</strong> / <strong>Unable to contract</strong> close the case and
          remove it from the open queue. Every change is logged in the notes below.
        </p>
        {isEditor ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {transitions.map(t => (
              <button key={t} className={BUTTON_STYLE[t]} disabled={busy} onClick={() => changeStatus(t)}>
                {BUTTON_LABEL[t]}
              </button>
            ))}
          </div>
        ) : (
          <span style={{ color: '#94a3b8', fontSize: 13 }}>Read-only — you don&apos;t have editor access.</span>
        )}
      </div>

      <div className="card">
        <h2>Notes &amp; history ({notes.length})</h2>
        {notes.length === 0 && <p style={{ color: '#94a3b8' }}>No notes yet.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notes.map(n => (
            <div key={n.id} style={{
              padding: '8px 12px', borderRadius: 8,
              background: n.is_system ? '#f1f5f9' : '#fff',
              border: n.is_system ? '1px dashed #cbd5e1' : '1px solid #e2e8f0',
              color: n.is_system ? '#475569' : 'inherit',
              fontSize: n.is_system ? 13 : 14,
            }}>
              <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, display: 'flex', gap: 8 }}>
                <span>{fmtTs(n.created_at)}{n.author ? ` · ${n.author}` : ''}{n.is_system ? ' · system' : ''}</span>
                {isEditor && !n.is_system && (
                  <button onClick={() => deleteNote(n)} style={{ border: 0, background: 'none', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
        {isEditor && (
          <div style={{ marginTop: 12 }}>
            <textarea value={noteText} rows={3} onChange={e => setNoteText(e.target.value)}
              style={{ width: '100%', padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, font: 'inherit' }}
              placeholder="Add a note — carrier response, ticket #, what's needed next, follow-up date…" />
            <button className="btn" style={{ marginTop: 8 }} disabled={busy || !noteText.trim()} onClick={postNote}>Add note</button>
          </div>
        )}
      </div>

      {siblings.length > 0 && (
        <div className="card">
          <h2>Other cases for this agent</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {siblings.map(s => {
              const ss = STATUS[s.status] || { label: s.status, badge: 'badge-warn' }
              return (
                <Link key={s.id} to={`/contracting/${s.id}`} className={`badge ${ss.badge}`} style={{ textDecoration: 'none' }}>
                  {s.carrier} · {ss.label}
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
