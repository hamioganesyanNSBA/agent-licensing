// Cigna Healthspring appointment report (CSV). See _prostat.js for the shared
// column mapping and RTS rule (MA rows; Active/Certified => rts Y).
import { parseProStat } from './_prostat.js'

export const meta = {
  key: 'healthspring',
  label: 'Cigna Healthspring Appointment Report',
  accept: '.csv',
  target: 'carrier_appointments',
}

export const parseFile = (file) => parseProStat(file, 'Cigna')
