import { TIER_1, TIER_2 } from '../lib/tiers.js'
import { US_STATE_PATHS } from '../lib/usStatePaths.js'

// Hand-tuned label positions for readability (x, y in SVG coords viewBox 0 0 959 593)
const LABELS = {
  AL: [643, 420], AK: [120, 505], AZ: [195, 355], AR: [545, 375],
  CA: [128, 365], CO: [310, 330], CT: [852, 230], DE: [810, 310],
  FL: [700, 490], GA: [680, 405], HI: [305, 535], ID: [215, 235],
  IL: [580, 315], IN: [625, 315], IA: [520, 265], KS: [430, 365],
  KY: [660, 350], LA: [560, 445], ME: [870, 140], MD: [790, 300],
  MA: [860, 215], MI: [630, 225], MN: [500, 195], MS: [600, 420],
  MO: [550, 340], MT: [300, 155], NE: [415, 290], NV: [170, 310],
  NH: [855, 180], NJ: [818, 285], NM: [280, 400], NY: [800, 210],
  NC: [735, 375], ND: [430, 155], OH: [690, 295], OK: [445, 400],
  OR: [155, 180], PA: [770, 270], RI: [862, 240], SC: [720, 405],
  SD: [420, 220], TN: [640, 370], TX: [400, 450], UT: [245, 315],
  VT: [835, 175], VA: [750, 340], WA: [165, 115], WV: [725, 325],
  WI: [555, 200], WY: [305, 240], DC: [800, 325],
}

export default function USMap() {
  return (
    <div className="card">
      <h2>Required Licensing States</h2>
      <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: 13 }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 14, background: '#14266b', borderRadius: 3, verticalAlign: -2, marginRight: 6 }}/>Tier 1 – Onboarding</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 14, background: '#d72328', borderRadius: 3, verticalAlign: -2, marginRight: 6 }}/>Tier 2 – After Metrics</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 14, background: '#e5e7eb', borderRadius: 3, verticalAlign: -2, marginRight: 6 }}/>Not required</span>
      </div>
      <svg viewBox="0 0 959 593" style={{ width: '100%', maxWidth: 800 }}>
        {Object.entries(US_STATE_PATHS).map(([code, d]) => {
          const tier1 = TIER_1.includes(code)
          const tier2 = TIER_2.includes(code)
          const fill = tier1 ? '#14266b' : tier2 ? '#d72328' : '#e5e7eb'
          return (
            <path key={code} d={d} fill={fill} stroke="#fff" strokeWidth="1.5" />
          )
        })}
        {Object.entries(LABELS).map(([code, [x, y]]) => {
          const tier1 = TIER_1.includes(code)
          const tier2 = TIER_2.includes(code)
          if (!tier1 && !tier2) return null
          return (
            <text key={`lbl-${code}`} x={x} y={y} textAnchor="middle"
              dominantBaseline="central" fill="#fff" fontSize="11"
              fontWeight="700" style={{ pointerEvents: 'none' }}>
              {code}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
