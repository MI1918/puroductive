-- Puroductive v12 — Company as the primary navigable context (Batch 1 of the
-- "Japanese company workspace" overhaul).
--
-- WHAT THIS ADDS
-- --------------
-- 1. companies.sort_order / projects.sort_order — fractional drag-order
--    columns (same idea as tasks.queue_order from schema_v9), so Companies
--    and Projects get the same reorder affordance tasks already have.
--    Backfilled from created_at so existing rows get a stable initial order
--    instead of colliding on null.
-- 2. member_groups.company_id / posts.company_id — nullable link to a
--    company. null keeps today's meaning ("workspace-wide"); set, it scopes
--    a department/group (and its chat channel) or a board post to one
--    company. No RLS changes needed — the existing workspace read/write
--    policies on both tables already cover the new column.
-- 3. profiles — a small, purely self-scoped table (full_name, job_role)
--    captured once at first sign-in, separate from team_members (the
--    roster of *assignable* people, which has no login of its own). Used to
--    (a) greet the signed-in user by name and (b) prefill their own roster
--    entry the moment they join a workspace.
-- 4. ensure_team_member_for_membership(p_membership_id) — call this right
--    after a membership becomes 'active' (accepting an invite, or creating
--    a workspace as its owner). If that membership isn't linked to a
--    roster entry yet, it creates one from the caller's own profile and
--    links it — this is what makes "joining a workspace adds you to its
--    Team roster" true going forward.
-- 5. One-time backfill: any workspace_members row that is *already* active
--    but never got linked to a roster entry (i.e. everyone who joined
--    before this migration) gets one now, named from their auth email
--    since profiles doesn't have historical data for them.
--
-- Run once, after schema_v11.sql. Safe to re-run — every ALTER is
-- if-not-exists, the backfills only touch rows still missing the new data,
-- and the function is CREATE OR REPLACE.

-- ============================================================================
-- 1. DRAG-REORDER COLUMNS
-- ============================================================================

alter table public.companies add column if not exists sort_order double precision;
alter table public.projects add column if not exists sort_order double precision;

with ranked as (
  select id, row_number() over (partition by workspace_id order by created_at, id) as rn
  from public.companies
  where deleted_at is null and sort_order is null
)
update public.companies c set sort_order = ranked.rn * 1000.0
from ranked where ranked.id = c.id;

with ranked as (
  select id, row_number() over (partition by workspace_id order by created_at, id) as rn
  from public.projects
  where deleted_at is null and sort_order is null
)
update public.projects p set sort_order = ranked.rn * 1000.0
from ranked where ranked.id = p.id;

-- ============================================================================
-- 2. COMPANY-SCOPING COLUMNS (groups/chat channels, board posts)
-- ============================================================================

alter table public.member_groups add column if not exists company_id text references public.companies(id);
alter table public.posts add column if not exists company_id text references public.companies(id);

-- ============================================================================
-- 3. PROFILES — self-managed identity (full name + role), not workspace data
-- ============================================================================

create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id),
  full_name   text not null,
  job_role    text not null,
  updated_at  text not null,
  created_at  text not null
);

alter table public.profiles enable row level security;

drop policy if exists "own profile select" on public.profiles;
create policy "own profile select" on public.profiles
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No other row ever needs to read your profile directly — team_members.name
-- (copied in by the function below) is what everyone else actually sees.

-- ============================================================================
-- 4. AUTO-ADD-TO-TEAM-ROSTER ON JOIN
-- ============================================================================
--
-- SECURITY DEFINER so it can insert into team_members regardless of the
-- caller's own write role (a brand-new member has no roster entry yet, so
-- can_write_workspace() would otherwise gate them out of the very insert
-- that's supposed to onboard them). Still safe: it only ever acts on a
-- membership row that is (a) the caller's own (user_id = auth.uid()) and
-- (b) already active, so this can't be used to plant a roster entry in a
-- workspace the caller doesn't belong to.

create or replace function public.ensure_team_member_for_membership(p_membership_id text)
returns text  -- the team_members id (existing or newly created)
language plpgsql
security definer
set search_path = public
as $$
declare
  mem record;
  prof record;
  new_member_id text;
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  roles_json text;
begin
  select * into mem from public.workspace_members
    where id = p_membership_id and user_id = auth.uid() and status = 'active' and deleted_at is null;
  if not found then
    raise exception 'No active membership found for you with that id';
  end if;

  if mem.member_id is not null then
    return mem.member_id;
  end if;

  select full_name, job_role into prof from public.profiles where user_id = auth.uid();

  new_member_id := 'm-' || replace(gen_random_uuid()::text, '-', '');
  roles_json := jsonb_build_object(
    'roles', case when prof.job_role is not null then jsonb_build_array(prof.job_role) else '[]'::jsonb end,
    'phone', '—',
    'email', mem.email
  )::text;

  -- owner_id predates workspaces (schema_v3's per-user ownership model) and
  -- is still NOT NULL on this table with a default of auth.uid() — fine for
  -- ordinary client inserts, but this runs SECURITY DEFINER, so auth.uid()
  -- still resolves to the calling user (not superuser/no-one), and is named
  -- explicitly here rather than relied on as a default for clarity.
  insert into public.team_members
    (id, name, roles_json, notes, is_external, is_default_delegate, group_id, workspace_id,
     competes_on_leaderboard, owner_id, updated_at, device_id, created_at)
  values (
    new_member_id, coalesce(prof.full_name, mem.email), roles_json, null, 0, 0, null, mem.workspace_id,
    1, auth.uid(), now_txt, 'rpc', now_txt
  );

  update public.workspace_members set member_id = new_member_id, updated_at = now_txt where id = mem.id;

  return new_member_id;
end $$;

revoke execute on function public.ensure_team_member_for_membership(text) from anon, authenticated, public;
grant execute on function public.ensure_team_member_for_membership(text) to authenticated;

-- ============================================================================
-- 5. ONE-TIME BACKFILL — link everyone already active but never rostered
-- ============================================================================

do $$
declare
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  create temporary table tmp_v12_backfill_links on commit drop as
  select wm.id as membership_id, wm.workspace_id, wm.email, wm.user_id,
         'm-' || replace(gen_random_uuid()::text, '-', '') as new_member_id
  from public.workspace_members wm
  where wm.status = 'active' and wm.deleted_at is null and wm.member_id is null;

  -- owner_id (predates workspaces — see the function above's comment) is set
  -- to each membership's own user_id, i.e. this roster entry is "owned" by
  -- the very person it represents, same as the RPC path above.
  insert into public.team_members
    (id, name, roles_json, notes, is_external, is_default_delegate, group_id, workspace_id,
     competes_on_leaderboard, owner_id, updated_at, device_id, created_at)
  select new_member_id, email, jsonb_build_object('roles', '[]'::jsonb, 'phone', '—', 'email', email)::text,
    null, 0, 0, null, workspace_id, 1, user_id, now_txt, 'migration', now_txt
  from tmp_v12_backfill_links;

  update public.workspace_members wm
  set member_id = t.new_member_id, updated_at = now_txt
  from tmp_v12_backfill_links t
  where wm.id = t.membership_id;
end $$;

-- ============================================================================
-- 6. VERIFY
-- ============================================================================

select p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ensure_team_member_for_membership';
