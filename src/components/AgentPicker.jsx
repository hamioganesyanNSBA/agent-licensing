import { useEffect, useMemo, useRef, useState } from 'react'

const MAX_RESULTS = 12

/**
 * Type-ahead agent picker. Type a name or NPN, matching agents drop down
 * below the box, click (or arrow + Enter) one to select it.
 *
 * Props:
 *   agents   — [{ npn, first_name, last_name }]
 *   value    — selected npn ('' for none)
 *   onChange — (npn) => void
 */
export default function AgentPicker({ agents, value, onChange, placeholder = 'Type an agent name or NPN…' }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const wrapRef = useRef(null)

  const selected = useMemo(() => agents.find(a => a.npn === value) || null, [agents, value])
  const label = (a) => `${a.last_name || ''}, ${a.first_name || ''}`.replace(/^, |, $/g, '')

  const matches = useMemo(() => {
    const s = query.trim().toLowerCase()
    if (!s) return agents.slice(0, MAX_RESULTS)
    const words = s.split(/\s+/)
    return agents.filter(a => {
      const hay = `${a.first_name || ''} ${a.last_name || ''} ${a.npn || ''}`.toLowerCase()
      return words.every(w => hay.includes(w))
    }).slice(0, MAX_RESULTS)
  }, [agents, query])

  useEffect(() => { setHi(0) }, [query])

  // Close on outside click.
  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pick(a) {
    onChange(a.npn)
    setQuery('')
    setOpen(false)
  }

  function onKey(e) {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[hi]) pick(matches[hi]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  if (selected) return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px',
      border: '1px solid #cbd5e1', borderRadius: 8, background: '#f8fafc' }}>
      <span style={{ fontWeight: 600 }}>{label(selected)}</span>
      <span style={{ color: '#64748b', fontSize: 12 }}>{selected.npn}</span>
      <button type="button" onClick={() => onChange('')} title="Change agent"
        style={{ border: 0, background: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13 }}>✕ change</button>
    </div>
  )

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: 360, maxWidth: '100%' }}>
      <input
        value={query}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        style={{ width: '100%' }}
        autoComplete="off"
      />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4,
          background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
          maxHeight: 320, overflowY: 'auto' }}>
          {matches.length === 0 && (
            <div style={{ padding: '10px 12px', color: '#64748b', fontSize: 13 }}>No agents match “{query}”.</div>
          )}
          {matches.map((a, i) => (
            <div key={a.npn}
              onMouseDown={e => { e.preventDefault(); pick(a) }}
              onMouseEnter={() => setHi(i)}
              style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 12,
                background: i === hi ? '#eff6ff' : '#fff' }}>
              <span>{label(a)}</span>
              <span style={{ color: '#64748b', fontSize: 12 }}>{a.npn}</span>
            </div>
          ))}
          {!query.trim() && agents.length > MAX_RESULTS && (
            <div style={{ padding: '6px 12px', color: '#94a3b8', fontSize: 11, borderTop: '1px solid #eef2f7' }}>
              Showing the first {MAX_RESULTS} of {agents.length} — keep typing to narrow down.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
