-- Supabase Dashboard > SQL Editor > New query, then run this SQL.
create table if not exists public.bloom_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bloom_user_data enable row level security;

-- Intentionally no client-facing policies.
-- The backend verifies the Supabase Auth access token and only queries the
-- row for the verified user. Never expose the service-role key to the browser.