/** States every new agent is licensed in at onboarding */
export const TIER_1 = ['AL','AZ','FL','IN','LA','MI','MS','NC','OK','SC','TX']

/** States added after the agent hits required metrics */
export const TIER_2 = ['GA','KS','KY','MO','OH','PA','TN','UT','WI']

/** All required states */
export const ALL_REQUIRED = [...TIER_1, ...TIER_2]
