import { useState } from 'react'
import { fetchAll } from '../lib/fetchAll.js'
import { buildSunfireRows, downloadSunfireXlsx } from '../lib/sunfireExport.js'

export default function SunfireExport() {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState([])
  const [total, setTotal] = useState(0)

  async function run({ download }) {
    setBusy(true)
    try {
      const [appointments, agents, licenseNpns] = await Promise.all([
        fetchAll('carrier_appointments',
          'agent_npn,first_name,last_name,email,carrier,plan_year,writing_number,state,product_category,rts_status'),
        fetchAll('agents', 'npn,first_name,last_name,email'),
        fetchAll('licenses', 'npn'),
      ])
      const activeNpns = new Set(licenseNpns.map(r => r.npn))
      const rows = buildSunfireRows(appointments, agents, activeNpns)
      setTotal(rows.length)
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
        <p>
          Generates the <code>NSBA_RTS_*.xlsx</code> file to upload to Sunfire. Includes only
          active agents and only states where they are ready to sell (RTS = Y); every appointed
          state carries all products (MA; PDP; CSNP; DSNP).
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn-secondary btn" disabled={busy} onClick={() => run({ download: false })}>Preview</button>
          <button className="btn"           disabled={busy} onClick={() => run({ download: true })}>Generate &amp; download</button>
          {total > 0 && <span style={{ color: '#64748b', fontSize: 13 }}>{total} rows</span>}
        </div>
      </div>

      {preview.length > 0 && (
        <div className="card">
          <h2>Preview (first 25 of {total} rows)</h2>
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
