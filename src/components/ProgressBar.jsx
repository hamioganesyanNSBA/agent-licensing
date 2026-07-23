// Visual progress bar for release workflows. value is 0..1.
export default function ProgressBar({ value, label, height = 10 }) {
  const pct = Math.round((value || 0) * 100)
  const color = pct === 100 ? '#16a34a' : pct >= 50 ? 'var(--nsba-blue)' : 'var(--nsba-navy)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 160 }}>
      <div style={{ flex: 1, height, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999,
                      transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>
        {label ?? `${pct}%`}
      </span>
    </div>
  )
}
