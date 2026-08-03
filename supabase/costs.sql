-- Licensing cost tracking: one row per Sircon billed transaction, imported
-- from the monthly "Billed Transactions" CSV exports.
-- SSN and EIN columns from the export are deliberately NOT stored.
-- Idempotent: safe to run (and re-run) as a whole in the Supabase SQL editor.

create table if not exists licensing_costs (
  id              bigserial primary key,
  date            date not null,
  state           text,                     -- 2-letter code
  service_code    text,                     -- e.g. 'NON - LICAPPL'
  service_desc    text,                     -- e.g. 'License Application'
  npn             text,                     -- individual producer NPN (null on firm-level rows)
  producer_name   text,                     -- "LAST, FIRST" (or firm name when no individual)
  is_firm         boolean not null default false,
  state_fee       numeric(10,2) not null default 0,
  sircon_fee      numeric(10,2) not null default 0,
  confirmation_id text not null default '',
  requested_by    text,                     -- Sircon username/email that ran the transaction
  source_file     text,
  imported_at     timestamptz default now(),
  -- Re-uploading an overlapping export skips existing rows. Confirmation ID
  -- alone is not unique (a confirmation can carry multiple service lines),
  -- so the fee fields are part of the key.
  unique (confirmation_id, service_code, state_fee, sircon_fee)
);
create index if not exists lc_date_idx on licensing_costs(date);
create index if not exists lc_npn_idx  on licensing_costs(npn);

alter table licensing_costs enable row level security;

-- Permissive policy matching the rest of the schema (admin-only app gated by Clerk).
drop policy if exists "anon all licensing_costs" on licensing_costs;
create policy "anon all licensing_costs" on licensing_costs for all using (true) with check (true);
