// Zing. Two formats, detected by header:
//
// Appointment report (ProStat CSV, has an extra AEP Status column we ignore)
//   — see _prostat.js for the shared column mapping and RTS rule (MA rows;
//   Active/Certified => rts Y). Plan year from the selector.
//
// Zing training report (ZING_Training_<timestamp>.csv) — one row per agent x
// year x training, NO states. Each agent-year has a "Zing Training" row
// (100 when the course is done, lower/blank when not) and usually a
// "Medicare Certificate" row (the AHIP-style exam score, 88-100). An agent is
// certified for a year when their "Zing Training" row for it is at 100; the
// Medicare Certificate score is not checked (its pass mark is not in the
// file, and a few certified agents have no such row). Only sets the upcoming
// AEP plan year (latest Year in the file, e.g. 2027) from the latest
// pre-AEP-year Zing rows in the DB — see _aepFromBase.js.
import { parseProStat } from './_prostat.js'
import { TRAINING_HEADER, aepRowsFromTrainingReport } from './_aepFromBase.js'

export const meta = {
  key: 'zing',
  label: 'Zing Appointments / Training',
  accept: '.csv',
  target: 'carrier_appointments',
}

export async function parseFile(file, opts) {
  const text = await file.text()
  if (TRAINING_HEADER.test(text.trimStart())) {
    const appointments = await aepRowsFromTrainingReport(text, {
      carrier: 'Zing',
      label: 'Zing training report',
      isCert: (name, progress) => name === 'zing training' && progress >= 100,
      firstUpload: 'the regular Zing appointment report',
    })
    return { appointments }
  }
  return parseProStat(file, 'Zing', opts)
}
