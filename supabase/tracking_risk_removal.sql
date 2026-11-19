-- Apply before deploying risk removal. These columns survive Shopify upserts.
alter table public.tracking_dashboard
  add column if not exists manual_status text,
  add column if not exists risk_removed_at timestamptz,
  add column if not exists risk_removal_reason text;

-- Refresh the REST API schema after adding the columns.
notify pgrst, 'reload schema';
