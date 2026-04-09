import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'

/**
 * Returns the set of NPNs that appear in the licenses table (the "All Licenses" report).
 * Any agent not in this set should be excluded from the UI.
 */
export function useLicensedNpns() {
  const [npns, setNpns] = useState(null)

  useEffect(() => {
    supabase
      .from('licenses')
      .select('npn')
      .limit(10000)
      .then(({ data }) => {
        const set = new Set((data || []).map(r => r.npn))
        setNpns(set)
      })
  }, [])

  return npns
}
