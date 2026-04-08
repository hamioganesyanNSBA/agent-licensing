import * as licenses from './licenses.js'
import * as aetna    from './aetna.js'
import * as uhc      from './uhc.js'
import * as devoted  from './devoted.js'
import * as wellcare from './wellcare.js'

export const IMPORTERS = {
  licenses,
  aetna,
  uhc,
  devoted,
  wellcare,
}

export const IMPORTER_LIST = Object.values(IMPORTERS).map(m => m.meta)
