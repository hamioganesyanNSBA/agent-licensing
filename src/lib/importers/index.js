// NOTE: The CSV "licenses" importer is retired — the `licenses` table is now
// populated (and pruned to active seats) exclusively by the Onyx sync
// (api/sync-licenses.js). It stays out of this registry on purpose so the two
// don't fight over the table.
import * as aetna       from './aetna.js'
import * as uhc         from './uhc.js'
import * as devoted     from './devoted.js'
import * as wellcare    from './wellcare.js'
import * as healthspring from './healthspring.js'
import * as scan        from './scan.js'
import * as zing        from './zing.js'
import * as anthem      from './anthem.js'

export const IMPORTERS = {
  aetna,
  uhc,
  devoted,
  wellcare,
  healthspring,
  scan,
  zing,
  anthem,
}

export const IMPORTER_LIST = Object.values(IMPORTERS).map(m => m.meta)
