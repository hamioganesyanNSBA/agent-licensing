-- UHC eAlliance state-add request log. Run in the Supabase SQL editor.
-- Idempotent: safe to run (and re-run) as a whole.
--
-- One row per (agent, state) each time a state add is included in a
-- downloaded eAlliance Non-Resident Appointments form. Used to suppress
-- duplicate requests: a pair requested within the last 10 business days is
-- held out of new forms; after that, if the appointment still hasn't shown
-- up in the UHC readiness data, it becomes requestable again.

create table if not exists uhc_state_requests (
  id             bigserial primary key,
  agent_npn      text not null,
  state          text not null,
  writing_number text,
  requested_at   timestamptz default now(),
  requested_by   text
);
create index if not exists usr_npn_idx  on uhc_state_requests(agent_npn);
create index if not exists usr_date_idx on uhc_state_requests(requested_at);

alter table uhc_state_requests enable row level security;

-- Permissive policy matching the rest of the schema (admin-only app gated by Clerk).
drop policy if exists "anon all uhc_state_requests" on uhc_state_requests;
create policy "anon all uhc_state_requests" on uhc_state_requests for all using (true) with check (true);
