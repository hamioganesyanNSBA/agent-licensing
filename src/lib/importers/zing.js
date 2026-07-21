// Zing appointment report (CSV). Has an extra AEP Status column we ignore.
// See _prostat.js for the shared column mapping and RTS rule
// (MA rows; Active/Certified => rts Y).
import { parseProStat } from './_prostat.js'

export const meta = {
  key: 'zing',
  label: 'Zing Appointment Report',
  accept: '.csv',
  target: 'carrier_appointments',
}

export const parseFile = (file) => parseProStat(file, 'Zing')
