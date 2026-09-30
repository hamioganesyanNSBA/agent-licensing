// Molina. Two formats, detected by header:
//
// Appointment report (ProStat CSV) — see _prostat.js for the shared column
//   mapping and RTS rule (MA rows; Active/Certified => rts Y). Plan year from
//   the selector.
//
// Molina certification report (Molina_Certification_<timestamp>.csv) —
// header: First Name, Last Name, Producer Type, Sub Type, NPN, Year,
// Certification Name, Certification Progress, Start Date, End Date. One row
// per agent x year x certification, NO states. Each agent-year has a
// "Medicare Product Training" row (100 when done, blank when not) and, for
// the AEP year, an "AHIP" row (exam score, 90-100). Older years also carry
// "FFM Certificate" / "Kentucky SBM" (marketplace, not MA) rows. An agent is
// certified for a year when their "Medicare Product Training" row for it is
// at 100; the AHIP score isn't checked (no pass mark in the file, same as
// Zing's Medicare Certificate). Only sets the upcoming AEP plan year (latest
// Year in the file, e.g. 2027) from the latest pre-AEP-year Molina rows in
// the DB — see _aepFromBase.js.
import { parseProStat } from './_prostat.js'
import { TRAINING_HEADER, aepRowsFromTrainingReport } from './_aepFromBase.js'

export const meta = {
  key: 'molina',
  label: 'Molina Appointments / Certification',
  accept: '.csv',
  target: 'carrier_appointments',
}

export async function parseFile(file, opts) {
  const text = await file.text()
  if (TRAINING_HEADER.test(text.trimStart())) {
    const appointments = await aepRowsFromTrainingReport(text, {
      carrier: 'Molina',
      label: 'Molina certification report',
      isCert: (name, progress) => name === 'medicare product training' && progress >= 100,
      firstUpload: 'the regular Molina appointment report',
    })
    return { appointments }
  }
  return parseProStat(file, 'Molina', opts)
}
