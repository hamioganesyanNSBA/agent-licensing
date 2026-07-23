-- Release workflow tables + document storage. Run once in the Supabase SQL editor.

create table if not exists release_workflows (
  id                          bigserial primary key,
  agent_npn                   text not null,
  agent_name                  text,
  status                      text not null default 'in_progress',  -- in_progress | completed | cancelled
  release_letter_path         text,
  release_letter_uploaded_at  timestamptz,
  aetna_hierarchy_path        text,
  aetna_hierarchy_uploaded_at timestamptz,
  notes                       text,
  created_by                  text,
  created_at                  timestamptz default now(),
  completed_at                timestamptz
);
create index if not exists rw_npn_idx    on release_workflows(agent_npn);
create index if not exists rw_status_idx on release_workflows(status);

create table if not exists release_carriers (
  id               bigserial primary key,
  workflow_id      bigint not null references release_workflows(id) on delete cascade,
  carrier          text not null,
  sent_at          timestamptz,   -- release sent to the carrier from our end
  approved_at      timestamptz,   -- carrier approved the contract
  rts_confirmed_at timestamptz,   -- agent officially appears in our RTS reports
  unique (workflow_id, carrier)
);
create index if not exists rc_workflow_idx on release_carriers(workflow_id);

alter table release_workflows enable row level security;
alter table release_carriers  enable row level security;

-- Permissive policies matching the rest of the schema (admin-only app gated by Clerk).
create policy "anon all release_workflows" on release_workflows for all using (true) with check (true);
create policy "anon all release_carriers"  on release_carriers  for all using (true) with check (true);

-- Storage bucket for uploaded release documents (public: documents are served
-- by URL; app access is gated by Clerk client-side like everything else).
insert into storage.buckets (id, name, public)
  values ('releases', 'releases', true)
  on conflict (id) do nothing;

create policy "anon manage release docs" on storage.objects
  for all using (bucket_id = 'releases') with check (bucket_id = 'releases');
