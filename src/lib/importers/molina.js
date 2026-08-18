// Molina appointment report (CSV). See _prostat.js for the shared
// column mapping and RTS rule (MA rows; Active/Certified => rts Y).
import { parseProStat } from './_prostat.js'

export const meta = {
  key: 'molina',
  label: 'Molina Appointment Report',
  accept: '.csv',
  target: 'carrier_appointments',
}

export const parseFile = (file, opts) => parseProStat(file, 'Molina', opts)
