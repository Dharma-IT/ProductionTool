create table if not exists public.orders_history (
  row_id text primary key,
  report_date date not null,
  client_name text,
  treatment text,
  medical_form text,
  source_file_name text,
  raw_data jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_history_report_date_idx on public.orders_history (report_date desc);
create index if not exists orders_history_client_name_idx on public.orders_history (client_name);

create or replace function public.set_orders_history_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists set_orders_history_updated_at on public.orders_history;
create trigger set_orders_history_updated_at before update on public.orders_history
for each row execute function public.set_orders_history_updated_at();

alter table public.orders_history enable row level security;
drop policy if exists "orders history anon read" on public.orders_history;
create policy "orders history anon read" on public.orders_history for select to anon using (true);
drop policy if exists "orders history anon insert" on public.orders_history;
create policy "orders history anon insert" on public.orders_history for insert to anon with check (true);
drop policy if exists "orders history anon update" on public.orders_history;
create policy "orders history anon update" on public.orders_history for update to anon using (true) with check (true);
grant usage on schema public to anon;
grant select, insert, update on public.orders_history to anon;
