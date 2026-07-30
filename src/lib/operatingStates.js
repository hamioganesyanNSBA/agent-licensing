// States where the agency does NOT sell or market (and so holds no agency
// license). Even when agents hold personal licenses there — or carrier RTS
// files list them as ready — these states are excluded from the Sunfire
// export, Coverage gap tracking, and the agency compliance check.
// Maintained by leadership; update when the agency's footprint changes.
export const NON_OPERATING_STATES = new Set([
  'AK', 'DC', 'HI', 'MA', 'NH', 'NY', 'VT', 'WY',
])

export const isOperatingState = (s) => !NON_OPERATING_STATES.has(s)
