import { supabase } from './supabase.js'

/**
 * Fetch all rows from a table, paginating past Supabase's 1000-row cap.
 * Returns an array of all matching rows.
 */
export async function fetchAll(table, select, filters = {}) {
  const PAGE = 1000
  let all = []
  let offset = 0
  while (true) {
    let q = supabase.from(table).select(select).range(offset, offset + PAGE - 1)
    if (filters.eq) for (const [col, val] of Object.entries(filters.eq)) q = q.eq(col, val)
    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}
