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

create index if not exists aircall_calls_started_at_idx
  on public.aircall_calls (started_at);

create index if not exists aircall_calls_phone_started_at_idx
  on public.aircall_calls (normalized_phone, started_at);

alter table public.aircall_calls enable row level security;

-- No anon/authenticated policies are intentional. The Render API accesses this
-- table only with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS server-side.
revoke all on table public.aircall_calls from anon, authenticated;
grant select, insert, update on table public.aircall_calls to service_role;
