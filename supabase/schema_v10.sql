-- Puroductive v10 — clock-in/out automation tokens (item 1: Samsung
-- Routines / Apple Shortcuts geofence integration).
--
-- WHAT THIS ADDS
-- --------------
-- automation_tokens — one row per personal webhook token a user generates
-- from the Calendar screen. The raw token itself is never stored: only its
-- SHA-256 hash (computed in the clock-webhook Edge Function), so a leaked
-- database dump can't be used to clock someone in or out. The raw token is
-- shown to the user exactly once, at generation time, in the UI.
--
-- These tokens exist specifically so a phone automation (Apple Shortcuts'
-- native arrive/leave trigger, or Tasker/Automate/IFTTT bridging Samsung's
-- own location-only Routines app) can call a webhook with no interactive
-- login involved — there is no Supabase session to attach in that context,
-- which is why this can't just reuse RLS the way every other write in this
-- app does. The clock-webhook function authenticates purely off the token
-- and runs on the service role; the table's own RLS below only governs the
-- authenticated browser session that generates/lists/revokes tokens.
--
-- Run once, after schema_v4.sql. Safe to re-run.

create table if not exists public.automation_tokens (
  id            text primary key,
  workspace_id  text not null references public.workspaces(id),
  user_id       uuid not null references auth.users(id) default auth.uid(),
  member_id     text references public.team_members(id),
  label         text not null default 'Clock automation',
  token_hash    text not null,
  last_used_at  text,
  revoked_at    text,
  updated_at    text not null,
  created_at    text not null
);

create index if not exists idx_automation_tokens_hash
  on public.automation_tokens (token_hash) where revoked_at is null;
create index if not exists idx_automation_tokens_user
  on public.automation_tokens (user_id, workspace_id);

alter table public.automation_tokens enable row level security;

-- Owner-only, same shape as google_calendar_connections in schema_v8.sql.
-- The clock-webhook function itself never goes through these policies — it
-- runs on the service role, which bypasses RLS entirely.
drop policy if exists "own automation tokens select" on public.automation_tokens;
create policy "own automation tokens select" on public.automation_tokens
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "own automation tokens insert" on public.automation_tokens;
create policy "own automation tokens insert" on public.automation_tokens
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));

-- Revoking is the only update the client needs (set revoked_at); nothing
-- else on a token is ever edited after creation.
drop policy if exists "own automation tokens revoke" on public.automation_tokens;
create policy "own automation tokens revoke" on public.automation_tokens
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
