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
RTS=Y when State Status is Active/Certified). Licenses are **not** imported by
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

## Notes

- Everything runs in the browser; there is no backend to run or deploy separately.
- `plan_year` is currently hardcoded (e.g. `2026` in `aetna.js`) — check when
  working across plan years.
