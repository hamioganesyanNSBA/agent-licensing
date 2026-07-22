// Clickable sortable column header + the sorting helpers that go with it.
// Usage:
//   const [sort, toggleSort] = useSortState('name')
//   <Th col={{ key: 'name', label: 'Name' }} sort={sort} onToggle={toggleSort} />
//   rows.sort(sortCompare(sort))
import { useState } from 'react'

export function useSortState(defaultKey, defaultDir = 'asc') {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir })
  const toggle = (key) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  return [sort, toggle]
}

// Numeric-aware, case-insensitive compare; nulls/blanks always sort last.
export function sortCompare({ key, dir }) {
  const mul = dir === 'asc' ? 1 : -1
  return (a, b) => {
    const av = a[key], bv = b[key]
    if ((av == null || av === '') && (bv == null || bv === '')) return 0
    if (av == null || av === '') return 1
    if (bv == null || bv === '') return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * mul
  }
}

export function Th({ col, sort, onToggle, style }) {
  return (
    <th onClick={() => onToggle(col.key)}
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}>
      {col.label}{sort.key === col.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
}
