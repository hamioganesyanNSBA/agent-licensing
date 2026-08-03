-- License renewal workflow table.
-- Idempotent: safe to run (and re-run) as a whole in the Supabase SQL editor.

create table if not exists license_renewals (
  id                  bigserial primary key,
  npn                 text not null,
  agent_name          text,
  state               text not null,
  license_number      text,
  expiration_date     date not null,   -- the expiration being renewed, captured at decision time
  decision            text not null,   -- 'renew' | 'skip'
  skip_reason         text,            -- 'not_in_marketing' | 'other' (when decision = 'skip')
  skip_notes          text,
  -- renew path: selected -> submitted (Sircon confirmation entered)
  --             -> completed (Onyx sync shows a later expiration; stamped automatically)
  -- skip path:  skipped (terminal)
  status              text not null default 'selected',
  confirmation_number text,
  submitted_at        timestamptz,
  completed_at        timestamptz,
  created_by          text,
  created_at          timestamptz default now()
);

-- One open renewal per license per expiration cycle. license_number can be
-- null on synced rows, so coalesce it into the key.
create unique index if not exists lr_unique_idx
  on license_renewals (npn, state, coalesce(license_number, ''), expiration_date);
create index if not exists lr_npn_idx    on license_renewals(npn);
create index if not exists lr_status_idx on license_renewals(status);

alter table license_renewals enable row level security;

-- Permissive policy matching the rest of the schema (admin-only app gated by Clerk).
drop policy if exists "anon all license_renewals" on license_renewals;
create policy "anon all license_renewals" on license_renewals for all using (true) with check (true);

-- Agency (business-entity) license renewals. Same lifecycle as agent renewals,
-- except completion is manual: agency licenses aren't in Onyx, so "Mark
-- renewed" updates the agency_licenses row's expiration directly (and the
-- auto-complete also notices expirations edited on the Agency Licenses page).
create table if not exists agency_license_renewals (
  id                  bigserial primary key,
  agency_license_id   bigint references agency_licenses(id) on delete set null,
  entity              text not null,
  state               text not null,
  license_number      text,
  expiration_date     date not null,   -- the expiration being renewed, captured at decision time
  decision            text not null,   -- 'renew' | 'skip'
  skip_reason         text,            -- 'not_in_marketing' | 'other' (when decision = 'skip')
  skip_notes          text,
  status              text not null default 'selected',  -- selected | submitted | completed | skipped
  confirmation_number text,
  submitted_at        timestamptz,
  completed_at        timestamptz,
  created_by          text,
  created_at          timestamptz default now()
);

create unique index if not exists alr_unique_idx
  on agency_license_renewals (entity, state, coalesce(license_number, ''), expiration_date);
create index if not exists alr_status_idx on agency_license_renewals(status);

alter table agency_license_renewals enable row level security;
drop policy if exists "anon all agency_license_renewals" on agency_license_renewals;
create policy "anon all agency_license_renewals" on agency_license_renewals for all using (true) with check (true);
