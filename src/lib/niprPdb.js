// Parser for NIPR "PDB Detail" PDF reports (my-nipr-order-<n>-detail.pdf) —
// the per-state producer-database report for a business entity. Extracts one
// row per license block in each state's "License Summary" section, mapped to
// the agency_licenses table shape (no entity — the caller supplies it).
//
// pdfjs-dist is loaded lazily so the PDF machinery stays out of the main bundle.
import { toDate } from './parse.js'

let pdfjsPromise = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })
  }
  return pdfjsPromise
}

// Rebuild visual lines from positioned text items: group by y (PDF y grows
// upward), then order each line's fragments left-to-right.
function pageText(content) {
  const items = content.items
    .filter(it => it.str && it.str.trim())
    .map(it => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  let cur = null
  for (const it of items) {
    if (!cur || Math.abs(cur.y - it.y) > 3) {
      cur = { y: it.y, parts: [it] }
      lines.push(cur)
    } else {
      cur.parts.push(it)
    }
  }
  return lines
    .map(l => l.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' '))
    .join('\n')
}

export async function readPdfText(file) {
  const pdfjs = await loadPdfjs()
  // destroy() lives on the loading task (PDFDocumentProxy lost it in pdfjs v6).
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
  try {
    const doc = await task.promise
    let text = ''
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      text += pageText(await page.getTextContent()) + '\n'
    }
    return text
  } finally {
    task.destroy()
  }
}

const squash = s => (s || '').replace(/\s+/g, ' ').trim()

// LOA table rows look like "Accident & Health or Sickness 02/26/2018 Active * 01/07/2025".
const LOA_ROW = /^(.*?)\s*(\d{2}\/\d{2}\/\d{4})\s+(Active|Inactive)\b/
// Lines that can never be a wrapped fragment of an LOA or Class name.
const NOT_NAME_FRAGMENT = /[:*\d]|^Authority$|Line of Authority|Issue Date|Status/

function parseLicenseBlock(state, block) {
  const num = block.match(/^\s*([A-Za-z0-9-]+)/)?.[1]
  if (!num) return null
  const active = block.match(/Active:\s*(Yes|No)/)?.[1]
  const lines = block.split('\n').map(l => l.trim())

  // Class cell text wraps below its row: "Class: BUSINESS ENTITY … " / "PRODUCER".
  let cls = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/Class:\s*(.*?)\s*Residency:/)
    if (!m) continue
    cls = m[1]
    for (let j = i + 1; j < lines.length && lines[j] && !NOT_NAME_FRAGMENT.test(lines[j]); j++) {
      cls += ` ${lines[j]}`
    }
    break
  }

  const loas = []
  let prev = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(LOA_ROW)
    if (m) {
      let name = m[1].trim()
      // A wrapped LOA name can leave a fragment on the previous line…
      if (prev && name && !NOT_NAME_FRAGMENT.test(prev)) name = `${prev} ${name}`
      // …or on the following line ("PRINCIPAL AGENCY- ACCIDENT AND" / "SICKNESS").
      const next = lines[i + 1]
      if (next && name && !NOT_NAME_FRAGMENT.test(next) && !LOA_ROW.test(next)) {
        name = `${name} ${next}`
        i++
      }
      if (m[3] === 'Active' && name && !loas.includes(name)) loas.push(name)
      prev = ''
    } else {
      prev = line
    }
  }

  return {
    state,
    license_number: num,
    license_type: squash(cls) || null,
    loa: loas.join('; ') || null,
    issue_date: toDate(block.match(/Issue Date:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]),
    expiration_date: toDate(block.match(/Expiration Date:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]),
    status: active === 'No' ? 'Inactive' : 'Active',
  }
}

// Parse the concatenated report text into { entityName, licenses }.
export function parsePdbText(rawText) {
  // Page footers ("20 of 152") land mid-table when a section spans pages.
  const text = rawText.replace(/^\d+ of \d+$/gm, '')
  const entityName = squash(
    text.match(/Name:\s*([^\n]+)/)?.[1]?.replace(/\s+(FEIN|NPN)\b.*$/, ''),
  ) || null

  // Carve the document into per-state sections.
  const marks = []
  const re = /Summary For State:\s*([A-Z]{2})\b/g
  for (let m; (m = re.exec(text)); ) marks.push({ state: m[1], idx: m.index })

  const licenses = []
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length
    const section = text.slice(marks[i].idx, end)
    // License data sits between "License Summary" and the "Appointments"
    // section (whose company tables also contain Active/date rows).
    const start = section.indexOf('License Summary')
    if (start < 0) continue
    let body = section.slice(start)
    const appts = body.search(/\bAppointments\b/)
    if (appts >= 0) body = body.slice(0, appts)
    for (const block of body.split(/License #:/).slice(1)) {
      const row = parseLicenseBlock(marks[i].state, block)
      if (row) licenses.push(row)
    }
  }
  return { entityName, licenses }
}

export async function parseNiprPdbPdf(file) {
  return parsePdbText(await readPdfText(file))
}
