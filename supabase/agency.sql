-- Agency (business-entity) license tracking. Agencies' own state licenses are
-- on NIPR but NOT in Onyx, so they're entered/imported manually in the app.
-- Idempotent: safe to run (and re-run) as a whole in the Supabase SQL editor.

create table if not exists agency_licenses (
  id              bigserial primary key,
  entity          text not null,             -- e.g. 'NSBA', 'HSK Insurance'
  state           text not null,             -- 2-letter code
  license_number  text,
  license_type    text,                      -- class, e.g. Business Entity Producer
  loa             text,
  issue_date      date,
  expiration_date date,
  status          text not null default 'Active',   -- Active | Inactive
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists al_entity_idx on agency_licenses(entity);
create index if not exists al_state_idx  on agency_licenses(state);
create index if not exists al_exp_idx    on agency_licenses(expiration_date);

alter table agency_licenses enable row level security;

drop policy if exists "anon all agency_licenses" on agency_licenses;
create policy "anon all agency_licenses" on agency_licenses for all using (true) with check (true);
