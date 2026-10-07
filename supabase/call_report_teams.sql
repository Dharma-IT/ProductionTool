create table if not exists public.call_report_teams (
  config_id text primary key,
  assignments jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.call_report_teams enable row level security;

drop policy if exists "call report teams anon read" on public.call_report_teams;
create policy "call report teams anon read"
on public.call_report_teams
for select
to anon
using (true);

drop policy if exists "call report teams anon insert" on public.call_report_teams;
create policy "call report teams anon insert"
on public.call_report_teams
for insert
to anon
with check (true);

drop policy if exists "call report teams anon update" on public.call_report_teams;
create policy "call report teams anon update"
on public.call_report_teams
for update
to anon
using (true)
with check (true);

grant usage on schema public to anon;
grant select, insert, update on public.call_report_teams to anon;
