create table if not exists public.aircall_calls (
  call_id text primary key,
  direction text not null,
  raw_digits text,
  normalized_phone text,
  user_id text,
  user_name text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  status text,
  missed_call_reason text,
  event_name text not null default 'call.ended',
  raw_data jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index if not exists aircall_calls_started_at_idx on public.aircall_calls (started_at);
create index if not exists aircall_calls_phone_idx on public.aircall_calls (normalized_phone);

alter table public.aircall_calls enable row level security;

drop policy if exists "aircall calls anon insert" on public.aircall_calls;
create policy "aircall calls anon insert"
on public.aircall_calls
for insert
to anon
with check (true);

drop policy if exists "aircall calls anon update" on public.aircall_calls;
create policy "aircall calls anon update"
on public.aircall_calls
for update
to anon
using (true)
with check (true);

grant usage on schema public to anon;
grant insert, update on public.aircall_calls to anon;
