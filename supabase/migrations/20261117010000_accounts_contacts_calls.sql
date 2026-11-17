-- Accounts, contacts, calls and push notifications for FamilyCall.
-- Profiles and calls are written only by the server (Edge Functions, secret key);
-- the browser reads them through the RLS policies below.

-- ---------------------------------------------------------------------------
-- Profiles: one per account. The username is the person's "phone number" in the app.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z]{3,20}[0-9]{0,3}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 60),
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Contacts: my saved family members.
create table public.contacts (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  contact_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, contact_id),
  check (owner_id <> contact_id)
);
create index contacts_contact_id_idx on public.contacts (contact_id);

-- ---------------------------------------------------------------------------
-- Calls: one row per ring, for recent / missed calls.
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.profiles (id) on delete cascade,
  callee_id uuid not null references public.profiles (id) on delete cascade,
  room_id text not null check (room_id ~ '^[a-z0-9-]{4,40}$'),
  status text not null default 'ringing'
    check (status in ('ringing', 'answered', 'declined', 'missed', 'cancelled')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index calls_caller_id_created_at_idx on public.calls (caller_id, created_at desc);
create index calls_callee_id_created_at_idx on public.calls (callee_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Web Push subscriptions: the devices that should ring for a user.
create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- Server-only settings (e.g. the Web Push signing key). No policies: only the
-- secret key used by Edge Functions can read or write it.
create table public.server_config (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.calls enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.server_config enable row level security;

revoke all on public.server_config from anon, authenticated;
revoke all on public.push_subscriptions from anon;
revoke all on public.profiles, public.contacts, public.calls from anon;

-- Table access for signed-in users (rows are still filtered by the policies below).
grant select on public.profiles, public.contacts, public.calls, public.push_subscriptions to authenticated;
grant delete on public.contacts, public.push_subscriptions to authenticated;
revoke insert, update, delete, truncate on public.calls from authenticated;
-- Edge Functions (secret key) manage everything.
grant all on public.profiles, public.contacts, public.calls, public.push_subscriptions, public.server_config to service_role;

-- Profiles: you see yourself, people you saved, and people who saved you
-- (so an incoming caller's name shows even if you haven't saved them yet).
create policy "Profiles: self and contacts can read"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.contacts c
      where c.owner_id = (select auth.uid()) and c.contact_id = profiles.id
    )
    or exists (
      select 1 from public.contacts c
      where c.contact_id = (select auth.uid()) and c.owner_id = profiles.id
    )
  );

-- You may change your own display name and "last seen" time, nothing else.
revoke update on public.profiles from authenticated;
grant update (display_name, last_seen) on public.profiles to authenticated;
create policy "Profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Contacts: only your own list. (Adding goes through the "family" Edge Function,
-- so you can find someone by exact username without being able to browse everyone.)
-- You can also see rows where you are the one saved: the profiles policy needs
-- them (RLS applies inside policies) to show who saved you.
create policy "Contacts: read own and where saved"
  on public.contacts for select to authenticated
  using (owner_id = (select auth.uid()) or contact_id = (select auth.uid()));
create policy "Contacts: delete own"
  on public.contacts for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Calls: only the two people involved can see a call.
create policy "Calls: participants can read"
  on public.calls for select to authenticated
  using (caller_id = (select auth.uid()) or callee_id = (select auth.uid()));

-- Push subscriptions: your own devices.
create policy "Push: read own"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Push: delete own"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime: each user has a private channel "user:<their id>" where incoming
-- calls arrive. Only that user can listen; only the server sends to it.
create policy "Realtime: listen on own call channel"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'user:' || (select auth.uid())::text
  );
