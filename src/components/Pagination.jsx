export default function Pagination({ page, total, perPage, onChange }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  if (totalPages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, fontSize: 13, color: '#64748b' }}>
      <button className="btn-secondary" style={{ padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 4, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.4 : 1 }} disabled={page <= 1} onClick={() => onChange(page - 1)}>&lt;</button>
      <span>{page} of {totalPages}</span>
      <button className="btn-secondary" style={{ padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 4, cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.4 : 1 }} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>&gt;</button>
      <span style={{ marginLeft: 8 }}>{total} total</span>
    </div>
  )
}
