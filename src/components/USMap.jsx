import { TIER_1, TIER_2 } from '../lib/tiers.js'
import { US_STATE_PATHS } from '../lib/usStatePaths.js'

const STATE_NAMES = {
  AL:'Alabama', AZ:'Arizona', FL:'Florida', IN:'Indiana', LA:'Louisiana',
  MI:'Michigan', MS:'Mississippi', NC:'North Carolina', OK:'Oklahoma',
  SC:'South Carolina', TX:'Texas', GA:'Georgia', KS:'Kansas', KY:'Kentucky',
  MO:'Missouri', OH:'Ohio', PA:'Pennsylvania', TN:'Tennessee', UT:'Utah', WI:'Wisconsin',
}

export default function USMap() {
  return (
    <div className="card">
      <h2>Required Licensing States</h2>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <svg viewBox="0 0 959 593" style={{ flex: '1 1 500px', maxWidth: 650 }}>
          {Object.entries(US_STATE_PATHS).map(([code, d]) => {
            const tier1 = TIER_1.includes(code)
            const tier2 = TIER_2.includes(code)
            const fill = tier1 ? '#14266b' : tier2 ? '#d72328' : '#e5e7eb'
            return <path key={code} d={d} fill={fill} stroke="#fff" strokeWidth="1.5" />
          })}
        </svg>
        <div style={{ flex: '0 0 220px', fontSize: 14 }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontWeight: 700, color: '#14266b' }}>
              <span style={{ display: 'inline-block', width: 12, height: 12, background: '#14266b', borderRadius: 3 }}/>
              Tier 1 – Onboarding
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
              {TIER_1.map(s => <li key={s}>{STATE_NAMES[s]} ({s})</li>)}
            </ul>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontWeight: 700, color: '#d72328' }}>
              <span style={{ display: 'inline-block', width: 12, height: 12, background: '#d72328', borderRadius: 3 }}/>
              Tier 2 – After Metrics
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
              {TIER_2.map(s => <li key={s}>{STATE_NAMES[s]} ({s})</li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
