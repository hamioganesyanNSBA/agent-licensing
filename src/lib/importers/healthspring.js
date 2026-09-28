// Cigna Healthspring. Two formats, detected by header:
//
// Appointment report (ProStat CSV) — see _prostat.js for the shared column
//   mapping and RTS rule (MA rows; Active/Certified => rts Y). Plan year from
//   the selector.
//
// HCSC training report (HCSC_Training_<timestamp>.csv) — header: First Name,
//   Last Name, Producer Type, Sub Type, NPN, Year, Training Name, Training
//   Progress, Start Date, End Date, Module Name. One row per agent x track x
//   module (rows are often duplicated), NO states. A module is complete when
//   any of its rows has a Training Progress (100, or the exam score); blank =
//   not done. An agent is certified for a year when every module of their MA
//   track for that year (External Telesales / External Field — the
//   "PDP-Only Markets" track doesn't count) is complete. "AHIP Medicare
//   Training" is optional: it's the alternative to uploading an existing AHIP
//   certificate, and most certified agents don't have it at all.
//   Like the Centene ProStat file for Wellcare, this only sets the upcoming
//   AEP plan year (the latest Year in the file, e.g. 2027): states come from
//   the latest pre-AEP-year Cigna rows already in the DB (so the appointment
//   report must be uploaded first), and a state is RTS=Y for the AEP year
//   when that row is Y AND the agent is certified. It never writes the
//   current year.
import { parseProStat } from './_prostat.js'
import { readCsv, rowsToObjects, clean } from '../parse.js'
import { aepRowsFromBase } from './_aepFromBase.js'

export const meta = {
  key: 'healthspring',
  label: 'Cigna Healthspring Appointments / HCSC Training',
  accept: '.csv',
  target: 'carrier_appointments',
}

const OPTIONAL_MODULES = new Set(['ahip medicare training'])

async function parseTraining(objects) {
  const aepYear = Math.max(...objects.map(r => parseInt(clean(r['Year']), 10)).filter(Number.isFinite))
  if (!Number.isFinite(aepYear)) {
    throw new Error('No training years found in this HCSC training report. Nothing was imported.')
  }

  // npn -> Map(module -> completed?) for the AEP year's MA tracks.
  const modules = new Map()
  for (const r of objects) {
    const npn = clean(r['NPN'])
    if (!npn || parseInt(clean(r['Year']), 10) !== aepYear) continue
    const track = clean(r['Training Name']) || ''
    if (/pdp-only/i.test(track)) continue
    const mod = (clean(r['Module Name']) || '').split(' - ').pop().toLowerCase()
    if (!mod || OPTIONAL_MODULES.has(mod)) continue
    if (!modules.has(npn)) modules.set(npn, new Map())
    const m = modules.get(npn)
    m.set(mod, m.get(mod) || !!clean(r['Training Progress']))
  }
  const certified = new Set()
  for (const [npn, m] of modules) if ([...m.values()].every(Boolean)) certified.add(npn)

  // States per agent from the appointment-report rows of the latest year before the AEP year.
  const appointments = await aepRowsFromBase('Cigna', aepYear, certified, 'the regular Cigna Healthspring appointment report')
  return { appointments }
}

export async function parseFile(file, opts) {
  const rows = await readCsv(file)
  const headers = (rows[0] || []).map(h => String(h ?? '').trim())
  if (headers.includes('Training Name') && headers.includes('Module Name') && headers.includes('NPN')) {
    return parseTraining(rowsToObjects(rows, 0))
  }
  return parseProStat(file, 'Cigna', opts)
}
