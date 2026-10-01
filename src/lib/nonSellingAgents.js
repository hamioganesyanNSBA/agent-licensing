// Agents who are still active Onyx seats (so the Onyx sync keeps their
// licenses, renewals and costs tracked) but no longer sell Medicare. They are
// left out of everything appointment-driven: the Appointments page, the
// Coverage page / gap model (and so the Agents-list coverage column and the
// UHC state-add form), the Sunfire export, the Dashboard RTS count, and the
// agency compliance check. Their carrier_appointments rows are still imported
// and shown on the agent profile (as history), just not acted on.
// Maintained by leadership; keyed by NPN so a name change can't break it.
export const NON_SELLING_AGENTS = {
  '17304437': 'Hamayak Oganesyan',
  '16193484': 'Mitchell Swersky',
  '16201100': 'Shaun Hunsaker',
  '21658564': 'Ronna Bethell',
  '21569148': 'Keyla Birtwistle',
}

export const NON_SELLING_NPNS = new Set(Object.keys(NON_SELLING_AGENTS))

export const isSellingAgent = (npn) => !NON_SELLING_NPNS.has(String(npn))
