-- Password recovery without email: each account can have one recovery code.
-- Only a salted PBKDF2 hash is stored, in a table only the server (secret key) can use.
create table public.account_recovery (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code_hash text not null,
  salt text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.account_recovery enable row level security;
revoke all on public.account_recovery from anon, authenticated;
grant all on public.account_recovery to service_role;

-- Lets the app remind people who haven't saved a recovery code yet.
-- Set only by the server (signed-in users can still update just display_name and last_seen).
alter table public.profiles add column recovery_set_at timestamptz;
