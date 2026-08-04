# Agent Licensing

Internal admin app for NSBA / HSK Insurance. Tracks insurance agents, their
state licenses, and carrier appointments; surfaces license-compliance and
expiration status; and exports agent readiness data for Sunfire.

## Stack

- **React 19** + **Vite 7**, **React Router 6** (`BrowserRouter`, client-side routing).
- **Supabase** (Postgres) via `@supabase/supabase-js` — the only backend. Accessed
  directly from the browser with the anon key.
- **Clerk** (`@clerk/clerk-react`) for auth, gated to an admin-email allowlist.
- **`xlsx`** (SheetJS) for parsing uploaded carrier spreadsheets / CSVs.
- Deploys on **Vercel** (SPA rewrite in `vercel.json`). No server/API layer.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run preview` — preview the build
- `npm run lint` — ESLint

There is no test suite.

## Environment variables (all `VITE_`-prefixed, client-exposed)

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — `src/lib/supabase.js`
- `VITE_CLERK_PUBLISHABLE_KEY` — required; app throws at boot without it (`src/main.jsx`)
- `VITE_ADMIN_EMAILS` — comma-separated allowlist. Empty = everyone signed-in is
  allowed; non-empty = only listed emails pass `AdminGate` (`src/App.jsx`)
- `VITE_EDITOR_EMAILS` — comma-separated subset who may change data (Onyx sync,
  file imports, clear-all — `src/lib/useIsEditor.js`). Empty = every admin is an
  editor. Client-side gating only, like the rest of the app.

## Layout

- `src/main.jsx` — providers: `ClerkProvider` → `BrowserRouter` → `App`.
- `src/App.jsx` — sidebar nav, routes, `AdminGate` (admin-email gate).
- `src/pages/` — one component per route: `Dashboard`, `Agents`, `AgentDetail`
  (`/agents/:npn`), `Licenses`, `Appointments`, `Imports`, `SunfireExport`.
- `src/components/` — `USMap`, `Pagination`.
- `src/lib/` — data + domain helpers (below).
- `src/index.css` — all styling (plain CSS, NSBA brand colors, `.card`/`.btn`
  classes). No CSS framework; components also use inline `style` objects.
- `supabase/schema.sql` — full DB schema, run manually in the Supabase SQL editor.

## Data model (`supabase/schema.sql`)

- **`agents`** — PK `npn`. Name/email. Derived from imports, not entered by hand.
- **`licenses`** — one row per `(npn, state, license_number, loa)` (unique). Has
  `status`, `expiration_date`, etc.
- **`carrier_appointments`** — one row per
  `(agent_npn, carrier, plan_year, state, product_category)` (unique). `rts_status`
  is `'Y'`/`'N'` (ready-to-sell).
- **`import_runs`** — audit log of each import (source, filename, row_count, who).

RLS is enabled but policies are **fully permissive** (`using (true)`) — security
rests entirely on Clerk client-side gating + keeping the anon key private. The
schema flags this as a TODO to tighten before any wider exposure.

## Key conventions

- **Supabase 1000-row cap:** a single `.select()` returns at most 1000 rows. Use
  `fetchAll(table, select, filters)` (`src/lib/fetchAll.js`) to page through
  everything. Don't add a bare `.select()` for data that can exceed 1000 rows.
- **State normalization:** carrier files use full state names inconsistently.
  Always run values through `toStateCode()` (`src/lib/states.js`) to get 2-letter
  codes before storing/comparing.
- **Onyx is the source of truth for licenses and the active agent roster.** The
  `licenses` (+ `agents`) tables are populated and pruned by the Onyx sync
  (`api/sync-licenses.js`, below), which mirrors only **active Onyx seats** and
  deletes anyone no longer active. `useLicensedNpns()` (distinct NPNs in
  `licenses`) is therefore the app-wide "who's a current agent" filter — the
  Agents, Licenses, and Appointments pages all gate on it. The old CSV
  `licenses` importer is retired so it can't fight the sync over the table.

## Onyx license sync (`api/sync-licenses.js`)

A Vercel serverless function that pulls agent licenses from the Onyx external API
(`https://api.onyxplatform.com`, `X-API-Key` header) and mirrors them into
Supabase. Triggered by the "Sync from Onyx" button on the Imports page (POST) and
a daily Vercel Cron (GET, 08:00 UTC — see `vercel.json`). It lists active users,
fetches each agent's licenses, delete-then-inserts the current set, and **prunes**
`licenses`/`agents` rows whose NPN isn't an active seat. Guarded to skip pruning
if the active list is empty (so an API hiccup can't wipe the tables). Server-only
env vars: `ONYX_API_KEY`, `SUPABASE_SERVICE_KEY` (falls back to anon), optional
`ONYX_ORG`/`ONYX_API_BASE`/`CRON_SECRET`. The API doesn't expose `license_type`,
`issue_date`, or `status_date/reason`, so those columns are null on synced rows.

## Importers (`src/lib/importers/`)

Registered in `index.js` (`IMPORTERS` map + `IMPORTER_LIST`) — these are the
manual file uploads on the Imports page, all targeting `carrier_appointments`:
`aetna`, `uhc`, `devoted`, `wellcare`, plus the "ProStat" carriers
`healthspring` (Cigna), `scan`, `zing` which share `_prostat.js` (MA rows only;
RTS=Y when State Status is Active/Certified). The `scan` importer also accepts
SCAN's newer "Agency Downlines" export (`AgencyDownlines_*.csv`, sniffed by
header): one row per broker with a comma-packed STATES column; it emits rows
for BOTH the selected plan year (CURR_YEAR_TRAINING) and the next
(NEXT_YEAR_TRAINING), and repairs the export's glued header/first-row line. Licenses are **not** imported by
file anymore — see the Onyx sync above.

Each importer module exports:

- `meta` — `{ key, label, accept, target }` (`accept` = file input filter,
  `target` = destination table, for display).
- `parseFile(file)` — async; returns `{ agents?, licenses?, appointments? }`
  arrays of plain row objects matching the table columns. Does parsing/mapping
  only — **no DB writes**.

The **Imports page** (`src/pages/Imports.jsx`) owns all persistence: it calls
`parseFile`, then upserts each returned array in 500-row chunks using the table's
unique constraint as `onConflict`, and records an `import_runs` row. To add a
carrier: create `src/lib/importers/<carrier>.js` following the `aetna.js` shape
and register it in `index.js` — the Imports page picks it up automatically.

Parsing helpers live in `src/lib/parse.js` (`readWorkbook`, `sheetToObjects`,
`readCsv`, `toDate`, `clean`). Carrier files are quirky — odd sheet names,
`\r`-only line endings (the ProStat CSVs; `readCsv` normalizes them), duplicate
column headers, and "LAST, FIRST" name formats are all real cases handled in
existing importers; mirror those patterns.

## Agency licenses (`/agency`)

Business-entity licenses (NSBA, HSK, …) are on NIPR but NOT in Onyx, so they're
managed manually: `agency_licenses` table from `supabase/agency.sql` (run
manually; page shows a setup notice if missing), CRUD + lenient NIPR-style CSV
import on the Agency Licenses page (editor-gated), expiration badges, and a
compliance check flagging states with RTS=Y agents but no active agency
license. Dashboard 30/60/90 boxes append agency expirations as a sub-line.

## License renewals (`/renewals`)

Tracks agent license renewals through Sircon: the Renewals page (and a "Renew
now" banner on the agent profile) groups an agent's licenses expiring within 90
days (`EXPIRING_WINDOW_DAYS`), the editor picks renew vs. don't-renew (skip
requires a reason — "Not in NSBA marketing" or "Other" with required notes),
applies in Sircon (link out), and records the transaction confirmation number,
which moves those licenses to "Completed — pending sync". A row auto-completes
when the Onyx license sync shows a later expiration for that license
(`autoCompleteRenewals()` in `src/lib/renewals.js`, run on renewal-page load);
submitted rows with no sync update after 7 business days are flagged for
follow-up. Table `license_renewals` from `supabase/renewals.sql` (run manually;
pages show a setup notice if missing). Renewals track whole licenses
(npn+state+license_number, all LOAs together), not per-LOA rows.

Agency licenses have a parallel flow at `/renewals/agency`
(`agency_license_renewals`, same SQL file): identical steps, but completion is
manual — agency licenses aren't in Onyx, so "Mark renewed" writes the new
expiration onto the `agency_licenses` row and closes the renewal (the
auto-complete also notices expirations edited on the Agency Licenses page).

The Onyx sync skips the platform's shared org login (`all-organization-login@`,
placeholder NPN 3333333) — it isn't an agent but carries ~50 license rows that
otherwise pollute every page (see `SYSTEM_NPNS` in `api/sync-licenses.js`).

## Release workflows (`/releases`)

Tracks carrier release processes per agent: select agent + carriers → upload
release letter (+ Aetna Hierarchy Change Request when Aetna is included) →
per-carrier Sent → Contract approved → Confirmed-in-RTS, every step
timestamped, with gating (steps must complete in order, undo in reverse).
Tables `release_workflows` / `release_carriers` and the public `releases`
storage bucket come from `supabase/releases.sql` (run manually in the Supabase
SQL editor — the Releases page shows a setup notice if missing). Progress and
completion logic live in `src/lib/releases.js`; a workflow auto-completes when
the letter is uploaded and every carrier is RTS-confirmed.

## Licensing costs (`/costs`)

Tracks licensing spend from Sircon's monthly "Billed Transactions" CSV exports:
upload (editor-gated, multi-file, dedup-safe via a
confirmation+service+fees unique key), timeframe presets / custom range,
filters by agent/state/service, breakdowns by month / agent / service / state,
paginated detail, and a multi-sheet .xlsx report download. Table
`licensing_costs` from `supabase/costs.sql` (run manually; page shows a setup
notice if missing). Parsing lives in `src/lib/sirconCosts.js`. The exports
contain SSN/EIN columns — these are deliberately never stored.

## Non-operating states (`src/lib/operatingStates.js`)

The agency deliberately doesn't sell/market in some states (AK DC HI MA NH NY
VT WY) and holds no agency licenses there. These are excluded from the Sunfire
export, Coverage gap math, and the agency compliance check — even when agents
hold personal licenses or carrier RTS files list them as ready. Update the set
when the agency footprint changes.

## Carrier footprints (`src/lib/carrierFootprints.js`)

The Coverage page compares appointments only against states where each carrier
actually sells MA plans. Regional footprints (SCAN, Zing, Devoted, Anthem) are
hardcoded there with sources; near-national carriers are `null` (unrestricted).
**Verified for plan year 2026 — must be re-verified every AEP.**

## Notes

- Everything runs in the browser; there is no backend to run or deploy separately.
- `plan_year` is currently hardcoded (e.g. `2026` in `aetna.js`) — check when
  working across plan years.
