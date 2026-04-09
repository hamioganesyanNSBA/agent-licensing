import { TIER_1, TIER_2 } from '../lib/tiers.js'

/*
 * Simplified US state map – each state is a <path> with its FIPS-style id.
 * Coordinates from a public-domain US map projection (Albers).
 */

const PATHS = {
  AL: 'M628,466 L628,527 L625,542 L617,545 L614,534 L604,542 L606,466Z',
  AK: 'M161,485 L183,485 L183,510 L194,510 L194,530 L161,530Z',
  AZ: 'M205,432 L258,432 L275,514 L220,528 L196,494 L196,450Z',
  AR: 'M556,451 L604,451 L606,504 L558,504Z',
  CA: 'M120,298 L168,298 L196,390 L196,494 L168,484 L130,440 L108,370Z',
  CO: 'M280,332 L368,332 L368,400 L280,400Z',
  CT: 'M828,235 L852,228 L858,248 L838,254 L828,248Z',
  DE: 'M800,316 L812,308 L816,328 L804,334Z',
  FL: 'M625,544 L690,525 L720,555 L710,600 L680,620 L650,600 L625,560Z',
  GA: 'M650,455 L692,455 L700,520 L656,535 L628,527 L628,466Z',
  HI: 'M260,545 L290,545 L295,558 L280,565 L260,560Z',
  ID: 'M218,175 L262,175 L270,275 L230,295 L210,250Z',
  IL: 'M570,290 L600,290 L602,390 L564,390 L562,330Z',
  IN: 'M604,290 L636,290 L636,390 L604,390Z',
  IA: 'M498,260 L568,260 L570,330 L500,330Z',
  KS: 'M396,370 L496,370 L496,420 L396,420Z',
  KY: 'M600,390 L694,370 L700,400 L620,412 L600,404Z',
  LA: 'M540,505 L590,505 L600,555 L570,570 L540,545Z',
  ME: 'M852,120 L880,110 L890,170 L862,195 L846,168Z',
  MD: 'M750,310 L800,300 L808,330 L780,340 L750,330Z',
  MA: 'M830,218 L870,210 L878,225 L840,235Z',
  MI: 'M590,178 L640,170 L650,260 L620,280 L590,260Z',
  MN: 'M470,140 L540,140 L544,250 L474,250Z',
  MS: 'M580,465 L606,466 L606,542 L600,555 L580,540Z',
  MO: 'M500,360 L564,360 L570,440 L510,442Z',
  MT: 'M260,115 L370,115 L372,200 L262,200Z',
  NE: 'M370,290 L468,280 L496,340 L370,340Z',
  NV: 'M168,250 L220,250 L220,390 L168,380Z',
  NH: 'M842,150 L856,145 L862,200 L844,210Z',
  NJ: 'M806,268 L818,260 L820,310 L806,318Z',
  NM: 'M258,430 L340,430 L344,520 L260,520Z',
  NY: 'M752,180 L830,170 L840,230 L818,250 L780,260 L752,230Z',
  NC: 'M660,410 L770,396 L780,425 L714,440 L660,440Z',
  ND: 'M380,130 L468,130 L470,200 L380,200Z',
  OH: 'M640,290 L700,280 L706,360 L645,370Z',
  OK: 'M370,415 L490,415 L500,460 L410,465 L370,445Z',
  OR: 'M118,155 L212,155 L218,240 L120,248Z',
  PA: 'M720,258 L806,248 L808,310 L726,318Z',
  RI: 'M850,238 L862,234 L864,250 L852,254Z',
  SC: 'M675,440 L724,430 L740,470 L690,480Z',
  SD: 'M380,200 L470,200 L472,280 L382,280Z',
  TN: 'M580,410 L690,400 L694,430 L582,440Z',
  TX: 'M340,440 L470,440 L490,520 L480,590 L420,600 L370,560 L340,510Z',
  UT: 'M230,290 L290,290 L290,400 L230,405Z',
  VT: 'M826,148 L842,144 L844,200 L828,210Z',
  VA: 'M680,350 L778,335 L790,380 L710,395 L680,380Z',
  WA: 'M130,90 L218,90 L220,170 L130,170Z',
  WV: 'M700,320 L740,310 L748,380 L710,388 L700,360Z',
  WI: 'M520,150 L580,160 L590,260 L530,260Z',
  WY: 'M272,200 L368,200 L370,290 L274,290Z',
  DC: 'M778,330 L784,326 L786,334 L780,336Z',
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
      <svg viewBox="80 70 850 560" style={{ width: '100%', maxWidth: 720 }}>
        {Object.entries(PATHS).map(([code, d]) => {
          const tier1 = TIER_1.includes(code)
          const tier2 = TIER_2.includes(code)
          const fill = tier1 ? '#14266b' : tier2 ? '#d72328' : '#e5e7eb'
          const textFill = tier1 || tier2 ? '#fff' : '#64748b'
          // compute rough centroid from path
          const nums = d.match(/\d+/g).map(Number)
          const xs = nums.filter((_, i) => i % 2 === 0)
          const ys = nums.filter((_, i) => i % 2 === 1)
          const cx = xs.reduce((a, b) => a + b, 0) / xs.length
          const cy = ys.reduce((a, b) => a + b, 0) / ys.length
          return (
            <g key={code}>
              <path d={d} fill={fill} stroke="#fff" strokeWidth="1.5" />
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                fill={textFill} fontSize={code.length <= 2 ? 10 : 8} fontWeight="600"
                style={{ pointerEvents: 'none' }}>{code}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
