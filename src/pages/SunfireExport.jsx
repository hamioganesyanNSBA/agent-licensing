import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { buildSunfireRows, downloadSunfireXlsx } from '../lib/sunfireExport.js'

export default function SunfireExport() {
  const [year, setYear] = useState(2026)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState([])

  async function run({ download }) {
    setBusy(true)
    try {
      // Fetch ALL appointments for the chosen plan year (paginated).
      let all = []
      let from = 0
      const PAGE = 1000
      while (true) {
        const { data, error } = await supabase
          .from('carrier_appointments')
          .select('agent_npn,first_name,last_name,email,carrier,plan_year,writing_number,state,product_category,rts_status')
          .eq('plan_year', year)
          .range(from, from + PAGE - 1)
        if (error) throw error
        all = all.concat(data || [])
        if (!data || data.length < PAGE) break
        from += PAGE
      }
      const rows = buildSunfireRows(all)
      setPreview(rows.slice(0, 25))
      if (download) {
        const today = new Date()
        const stamp = `${today.getMonth()+1}.${today.getDate()}.${today.getFullYear()}`
        downloadSunfireXlsx(rows, `NSBA_RTS_${stamp}.xlsx`)
      }
    } catch (e) {
      alert(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1>Sunfire RTS Export</h1>
      <div className="card">
        <p>Generates the <code>NSBA_RTS_*.xlsx</code> file to upload to Sunfire. Reflects current data in this app for the selected plan year.</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label>Plan year:&nbsp;
            <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))}>
              <option value={2025}>2025</option>
              <option value={2026}>2026</option>
            </select>
          </label>
          <button className="btn-secondary btn" disabled={busy} onClick={() => run({ download: false })}>Preview</button>
          <button className="btn"           disabled={busy} onClick={() => run({ download: true })}>Generate &amp; download</button>
        </div>
      </div>

      {preview.length > 0 && (
        <div className="card">
          <h2>Preview (first 25 rows)</h2>
          <table>
            <thead><tr>{Object.keys(preview[0]).map(k => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{String(v ?? '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
