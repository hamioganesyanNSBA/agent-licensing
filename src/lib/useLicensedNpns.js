import { useEffect, useState } from 'react'
import { fetchAll } from './fetchAll.js'

/**
 * Returns the set of NPNs that appear in the licenses table (the "All Licenses" report).
 * Any agent not in this set should be excluded from the UI.
 */
export function useLicensedNpns() {
  const [npns, setNpns] = useState(null)

  useEffect(() => {
    fetchAll('licenses', 'npn').then(data => {
      setNpns(new Set(data.map(r => r.npn)))
    })
  }, [])

  return npns
}
