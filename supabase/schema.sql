-- Agent Licensing schema. Run in Supabase SQL editor.

create table if not exists agents (
  npn            text primary key,
  first_name     text,
  last_name      text,
  email          text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create table if not exists licenses (
  id              bigserial primary key,
  licensee_name   text not null,
  npn             text not null,
  state           text not null,
  license_type    text,
  license_number  text,
  loa             text,
  issue_date      date,
  expiration_date date,
  status          text,
  status_date     date,
  status_reason   text,
  imported_at     timestamptz default now(),
  unique (npn, state, license_number, loa)
);
create index if not exists licenses_npn_idx        on licenses(npn);
create index if not exists licenses_state_idx      on licenses(state);
create index if not exists licenses_expiration_idx on licenses(expiration_date);

-- One row per agent × carrier × plan year × state × product
create table if not exists carrier_appointments (
  id                bigserial primary key,
  agent_npn         text not null,
  first_name        text,
  last_name         text,
  email             text,
  carrier           text not null,
  plan_year         int  not null,
  writing_number    text,
  state             text not null,
  product_category  text,
  rts_status        text,           -- 'Y' / 'N'
  source_file       text,
  imported_at       timestamptz default now(),
  unique (agent_npn, carrier, plan_year, state, product_category)
);
create index if not exists ca_npn_idx     on carrier_appointments(agent_npn);
create index if not exists ca_carrier_idx on carrier_appointments(carrier);
create index if not exists ca_state_idx   on carrier_appointments(state);
create index if not exists ca_year_idx    on carrier_appointments(plan_year);

create table if not exists import_runs (
  id            bigserial primary key,
  source        text not null,    -- 'licenses' | 'aetna' | 'uhc' | 'devoted' | 'wellcare' | ...
  filename      text,
  row_count     int,
  imported_by   text,
  imported_at   timestamptz default now(),
  notes         text
);

-- RLS: lock everything down. App uses anon key + Clerk gating in front;
-- once you're ready to enforce server-side, replace with policies tied to Clerk JWTs.
alter table agents               enable row level security;
alter table licenses             enable row level security;
alter table carrier_appointments enable row level security;
alter table import_runs          enable row level security;

-- Permissive policies for now (admin-only app, gated by Clerk client-side).
-- TIGHTEN THESE before exposing the anon key publicly.
create policy "anon all agents"        on agents               for all using (true) with check (true);
create policy "anon all licenses"      on licenses             for all using (true) with check (true);
create policy "anon all appointments"  on carrier_appointments for all using (true) with check (true);
create policy "anon all imports"       on import_runs          for all using (true) with check (true);
