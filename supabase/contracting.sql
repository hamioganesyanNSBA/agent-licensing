-- Carrier contracting issues: agents whose initial carrier contracting hit a
-- problem (declined for compliance, data mismatch, ...). One case per
-- (agent, carrier); open cases are pending or resubmitted, exit statuses are
-- approved / unable_to_contract. Notes are a thread per case; status changes
-- are logged into the same thread as system notes.
-- Idempotent: safe to run (and re-run) as a whole in the Supabase SQL editor.

create table if not exists contracting_issues (
  id              bigserial primary key,
  agent_npn       text not null,
  agent_name      text,
  carrier         text not null,
  reason          text,                      -- Compliance | Data mismatch | Background | Other
  reason_detail   text,
  status          text not null default 'pending',   -- pending | resubmitted | approved | unable_to_contract
  opened_at       timestamptz default now(),
  resubmitted_at  timestamptz,               -- most recent resubmission
  closed_at       timestamptz,               -- set on approved / unable_to_contract
  created_by      text,
  updated_at      timestamptz default now()
);
create index if not exists ci_npn_idx    on contracting_issues(agent_npn);
create index if not exists ci_status_idx on contracting_issues(status);

create table if not exists contracting_issue_notes (
  id          bigserial primary key,
  issue_id    bigint not null references contracting_issues(id) on delete cascade,
  body        text not null,
  is_system   boolean not null default false,   -- true = auto-logged status change
  author      text,
  created_at  timestamptz default now()
);
create index if not exists cin_issue_idx on contracting_issue_notes(issue_id);

alter table contracting_issues       enable row level security;
alter table contracting_issue_notes  enable row level security;

-- Permissive policies matching the rest of the schema (admin-only app gated by Clerk).
drop policy if exists "anon all contracting_issues"      on contracting_issues;
drop policy if exists "anon all contracting_issue_notes" on contracting_issue_notes;
create policy "anon all contracting_issues"      on contracting_issues      for all using (true) with check (true);
create policy "anon all contracting_issue_notes" on contracting_issue_notes for all using (true) with check (true);
