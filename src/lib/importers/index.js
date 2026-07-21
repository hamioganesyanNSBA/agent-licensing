import * as licenses    from './licenses.js'
import * as aetna       from './aetna.js'
import * as uhc         from './uhc.js'
import * as devoted     from './devoted.js'
import * as wellcare    from './wellcare.js'
import * as healthspring from './healthspring.js'
import * as scan        from './scan.js'
import * as zing        from './zing.js'

export const IMPORTERS = {
  licenses,
  aetna,
  uhc,
  devoted,
  wellcare,
  healthspring,
  scan,
  zing,
}

export const IMPORTER_LIST = Object.values(IMPORTERS).map(m => m.meta)
