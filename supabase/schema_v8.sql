-- Puroductive v8 — Google Calendar two-way sync (item 4).
--
-- THE PIECES
-- ----------
-- 1. google_oauth_states — short-lived, single-use rows bridging the
--    authenticated "start" step (where we know who's asking) to the
--    unauthenticated "callback" step (Google's redirect, which carries no
--    Puroductive session). Touched only by Edge Functions using the service
--    role; RLS is enabled with zero policies, which is a deliberate deny-all
--    for the anon/authenticated API — nobody reaches this table except
--    through the functions that bypass RLS entirely.
-- 2. google_calendar_connections — one row per (user, workspace): the
--    refresh token and incremental-sync bookmark. User-scoped RLS for
--    reading your own connection status and disconnecting; no INSERT policy
--    for authenticated, since the only writer is the callback function
--    (service role, same reasoning as google_oauth_states).
-- 3. calendar_events.google_event_id — the link between a Puroductive event
--    and its Google counterpart, so sync can tell "already imported this"
--    from "this is new" and support updates/deletes in both directions.
--
-- SCOPE — what this does NOT attempt: recurring events (RRULE expansion is
-- a feature on its own), attendee sync, or calendars other than the
-- connected account's primary calendar. Single events, all-day or timed,
-- both directions.
--
-- Run once, after schema_v4.sql. Safe to re-run.

create table if not exists public.google_oauth_states (
  state         text primary key,
  user_id       uuid not null references auth.users(id),
  workspace_id  text not null references public.workspaces(id),
  created_at    text not null
);
alter table public.google_oauth_states enable row level security;
-- No policies — see note above. This is intentional, not an oversight.

create table if not exists public.google_calendar_connections (
  id              text primary key,
  user_id         uuid not null references auth.users(id),
  workspace_id    text not null references public.workspaces(id),
  google_email    text,
  refresh_token   text not null,
  calendar_id     text not null default 'primary',
  sync_token      text,
  connected_at    text not null,
  last_synced_at  text,
  updated_at      text not null,
  created_at      text not null,
  deleted_at      text
);
create unique index if not exists uq_google_calendar_connections_user_ws
  on public.google_calendar_connections (user_id, workspace_id) where deleted_at is null;

alter table public.google_calendar_connections enable row level security;

drop policy if exists "own connection" on public.google_calendar_connections;
create policy "own connection" on public.google_calendar_connections
  for select to authenticated
  using (user_id = auth.uid());

-- Disconnecting is the one write the client itself needs — everything else
-- (creating the row, updating sync_token/last_synced_at) goes through Edge
-- Functions on the service role.
drop policy if exists "disconnect own connection" on public.google_calendar_connections;
create policy "disconnect own connection" on public.google_calendar_connections
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.calendar_events add column if not exists google_event_id text;
-- Deliberately NOT a partial index (no `where google_event_id is not null`).
-- Postgres's ON CONFLICT (columns) inference does not match a partial
-- index from a plain column list — confirmed by testing the exact upsert
-- the sync Edge Function issues, which failed with 42P10 "no unique or
-- exclusion constraint matching the ON CONFLICT specification" against the
-- partial version. The predicate was unnecessary anyway: multiple NULL
-- google_event_id rows never violate a unique constraint under standard
-- SQL NULL semantics, so this gives the same practical guarantee while
-- actually working as an ON CONFLICT target.
create unique index if not exists uq_calendar_events_google_event
  on public.calendar_events (workspace_id, google_event_id);
