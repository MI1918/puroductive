-- Puroductive v4 — shared workspaces, real memberships, roles.
--
-- WHY THIS EXISTS
-- ---------------
-- schema_v3.sql made every table private: `owner_id = auth.uid()` plus an
-- RLS policy of "only the row's owner may touch it". That was the right call
-- when the deployed link was being handed to strangers who each needed their
-- own empty sandbox. But it also means two people can never look at the same
-- project, which makes real collaboration impossible — "team members" are
-- currently just names typed into a roster, not accounts.
--
-- v4 inverts the rule: a row belongs to a WORKSPACE, and you can see it if
-- you are an active member of that workspace. One person working alone is
-- just a workspace with one member, so nothing about the solo experience
-- changes.
--
-- NOTHING IS DELETED
-- ------------------
-- This migration is purely additive. `owner_id` is kept on every table (it
-- still records who created the row, and it is the thing this script reads to
-- decide which workspace your existing data belongs in). Every row that
-- exists today is moved into a personal workspace owned by whoever owns it
-- now, so after running this you sign in and see exactly what you saw before.
--
-- BEFORE RUNNING: take a backup. Supabase Dashboard -> Database -> Backups,
-- or `pg_dump`. This rewrites RLS policies on twelve tables; a backup is
-- cheap insurance and this script cannot make one for you.
--
-- Run once in the Supabase SQL editor, after rls.sql, schema_v2.sql and
-- schema_v3.sql. Safe to re-run (every step is idempotent).

-- ============================================================================
-- 1. WORKSPACES
-- ============================================================================

create table if not exists public.workspaces (
  id          text primary key,
  name        text not null,
  -- 'personal' workspaces are auto-created (one per user, holds their v3
  -- data and anything they make solo) and cannot be left or deleted. 'team'
  -- workspaces are the ones you create and invite people into.
  kind        text not null default 'team' check (kind in ('personal', 'team')),
  created_by  uuid references auth.users(id) default auth.uid(),
  version     integer not null default 1,
  updated_at  text not null,
  device_id   text not null default 'sql',
  created_at  text not null,
  deleted_at  text
);

-- A membership row is created in one of two states:
--   'invited' — someone typed an email into the invite box. user_id is still
--               null because that person may not have an account yet.
--   'active'  — that person signed in, and claim_workspace_invites() matched
--               their auth email to the invite and stamped user_id.
-- This two-step shape is what lets you invite people who have never heard of
-- Puroductive, and is why user_id is nullable.
create table if not exists public.workspace_members (
  id            text primary key,
  workspace_id  text not null references public.workspaces(id),
  user_id       uuid references auth.users(id),
  -- Optional link to the roster entry in team_members. Roster entries that
  -- nobody has been invited as stay unclaimed placeholders — you can still
  -- assign tasks to them, exactly as today.
  member_id     text references public.team_members(id),
  email         text not null,
  role          text not null default 'member'
                check (role in ('owner', 'admin', 'member', 'viewer')),
  status        text not null default 'invited'
                check (status in ('invited', 'active', 'removed')),
  invited_by    uuid references auth.users(id),
  version       integer not null default 1,
  updated_at    text not null,
  device_id     text not null default 'sql',
  created_at    text not null,
  deleted_at    text
);

-- Email match is case-insensitive on claim, so store/compare lowercased.
create unique index if not exists uq_workspace_members_ws_email
  on public.workspace_members (workspace_id, lower(email))
  where deleted_at is null;
create index if not exists idx_workspace_members_user
  on public.workspace_members (user_id) where deleted_at is null;

-- ============================================================================
-- 2. MEMBERSHIP HELPERS (security definer — this is what prevents recursion)
-- ============================================================================
--
-- An RLS policy on workspace_members that itself SELECTs workspace_members
-- deadlocks Postgres into infinite recursion. The standard escape is a
-- `security definer` function: it runs as the function's owner, so RLS is not
-- re-evaluated inside it. Every policy below goes through these two.

create or replace function public.is_workspace_member(ws text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = ws
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.deleted_at is null
  );
$$;

-- Write-side gate. 'viewer' is read-only: they see the workspace but every
-- insert/update/delete policy calls this instead of is_workspace_member.
create or replace function public.can_write_workspace(ws text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = ws
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin', 'member')
      and wm.deleted_at is null
  );
$$;

create or replace function public.is_workspace_admin(ws text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = ws
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
      and wm.deleted_at is null
  );
$$;

grant execute on function public.is_workspace_member(text) to authenticated;
grant execute on function public.can_write_workspace(text) to authenticated;
grant execute on function public.is_workspace_admin(text) to authenticated;

-- ============================================================================
-- 3. ADD workspace_id TO EVERY DATA TABLE, AND BACKFILL IT
-- ============================================================================
--
-- Backfill strategy: each distinct owner_id currently in the data gets one
-- personal workspace, and every row they own moves into it. Because v3 made
-- owner_id NOT NULL on all twelve tables, no row can be missed.

do $$
declare
  data_tables text[] := array[
    'companies', 'team_members', 'member_company_links', 'member_groups',
    'projects', 'tasks', 'task_transitions', 'handoffs', 'reflections',
    'calendar_exceptions', 'calendar_events', 'work_sessions'
  ];
  t text;
  u record;
  ws_id text;
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  -- 3a. Column first, nullable, on every table.
  foreach t in array data_tables loop
    execute format(
      'alter table public.%I add column if not exists workspace_id text references public.workspaces(id);', t
    );
  end loop;

  -- 3b. One personal workspace per user who owns any data today. Collect the
  --     owners from every table so a user who somehow owns only, say,
  --     work_sessions still gets a workspace.
  for u in
    select distinct owner_id from (
      select owner_id from public.companies
      union select owner_id from public.team_members
      union select owner_id from public.member_company_links
      union select owner_id from public.member_groups
      union select owner_id from public.projects
      union select owner_id from public.tasks
      union select owner_id from public.task_transitions
      union select owner_id from public.handoffs
      union select owner_id from public.reflections
      union select owner_id from public.calendar_exceptions
      union select owner_id from public.calendar_events
      union select owner_id from public.work_sessions
    ) all_owners
    where owner_id is not null
  loop
    -- Re-runnable: reuse this user's personal workspace if it already exists.
    select id into ws_id from public.workspaces
      where created_by = u.owner_id and kind = 'personal' and deleted_at is null
      limit 1;

    if ws_id is null then
      ws_id := 'ws-' || replace(u.owner_id::text, '-', '');
      insert into public.workspaces (id, name, kind, created_by, updated_at, created_at)
      values (ws_id, 'My workspace', 'personal', u.owner_id, now_txt, now_txt)
      on conflict (id) do nothing;
    end if;

    -- The owner is, unsurprisingly, the owner.
    insert into public.workspace_members
      (id, workspace_id, user_id, email, role, status, invited_by, updated_at, created_at)
    select 'wm-' || replace(u.owner_id::text, '-', ''), ws_id, u.owner_id,
           lower(coalesce(au.email, 'unknown@local')), 'owner', 'active', u.owner_id, now_txt, now_txt
    from auth.users au where au.id = u.owner_id
    on conflict (id) do nothing;

    -- 3c. Move this user's existing rows into their personal workspace.
    foreach t in array data_tables loop
      execute format(
        'update public.%I set workspace_id = %L where owner_id = %L and workspace_id is null;',
        t, ws_id, u.owner_id
      );
    end loop;
  end loop;

  -- 3d. Every row now has a workspace, so require it going forward. Any row
  --     inserted from here on must name its workspace explicitly.
  foreach t in array data_tables loop
    execute format('alter table public.%I alter column workspace_id set not null;', t);
    execute format('create index if not exists idx_%s_workspace on public.%I (workspace_id);', t, t);
  end loop;
end $$;

-- ============================================================================
-- 4. RLS — from "you own it" to "you're in its workspace"
-- ============================================================================

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists "workspace visible to members" on public.workspaces;
create policy "workspace visible to members" on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id) or created_by = auth.uid());

drop policy if exists "workspace created by self" on public.workspaces;
create policy "workspace created by self" on public.workspaces
  for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "workspace edited by admins" on public.workspaces;
create policy "workspace edited by admins" on public.workspaces
  for update to authenticated
  using (public.is_workspace_admin(id)) with check (public.is_workspace_admin(id));

-- You can always see your own membership row (that is how the app discovers
-- which workspaces you belong to before it knows anything else), plus every
-- membership row of any workspace you are already in (the Members screen).
drop policy if exists "membership visible" on public.workspace_members;
create policy "membership visible" on public.workspace_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

-- Only owners/admins hand out or revoke access. The one exception is the
-- bootstrap case: creating the very first membership of a workspace you just
-- created, when is_workspace_admin() would still be false.
drop policy if exists "membership managed by admins" on public.workspace_members;
create policy "membership managed by admins" on public.workspace_members
  for insert to authenticated
  with check (
    public.is_workspace_admin(workspace_id)
    or exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.created_by = auth.uid()
    )
  );

drop policy if exists "membership updated by admins" on public.workspace_members;
create policy "membership updated by admins" on public.workspace_members
  for update to authenticated
  using (public.is_workspace_admin(workspace_id))
  with check (public.is_workspace_admin(workspace_id));

-- The twelve data tables: read if you're a member, write if you're not a viewer.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'companies', 'team_members', 'member_company_links', 'member_groups',
    'projects', 'tasks', 'task_transitions', 'handoffs', 'reflections',
    'calendar_exceptions', 'calendar_events', 'work_sessions'
  ])
  loop
    execute format('alter table public.%I enable row level security;', t);
    -- Retire the v1 and v3 policies. Dropping them is what actually opens the
    -- table up to teammates; the workspace policies below take over.
    execute format('drop policy if exists "authenticated full access" on public.%I;', t);
    execute format('drop policy if exists "owner full access" on public.%I;', t);
    execute format('drop policy if exists "workspace read" on public.%I;', t);
    execute format('drop policy if exists "workspace write" on public.%I;', t);
    execute format('drop policy if exists "workspace update" on public.%I;', t);

    execute format(
      'create policy "workspace read" on public.%I for select to authenticated
         using (public.is_workspace_member(workspace_id));', t);
    execute format(
      'create policy "workspace write" on public.%I for insert to authenticated
         with check (public.can_write_workspace(workspace_id));', t);
    -- No DELETE policy anywhere on purpose: this app tombstones via
    -- deleted_at and never hard-deletes, so UPDATE is the only write path
    -- that removal needs. Leaving DELETE unpoliced means it is denied.
    execute format(
      'create policy "workspace update" on public.%I for update to authenticated
         using (public.can_write_workspace(workspace_id))
         with check (public.can_write_workspace(workspace_id));', t);
  end loop;
end $$;

-- ============================================================================
-- 5. CLAIMING AN INVITE
-- ============================================================================
--
-- Called by the app on every sign-in. Finds invites addressed to this user's
-- email that are still waiting for an account, and attaches them. Security
-- definer because an invited user is by definition not yet a member, so RLS
-- would hide the very row they need to claim. It only ever touches rows whose
-- email equals the caller's own verified auth email, so it cannot be used to
-- join a workspace you were not invited to.

create or replace function public.claim_workspace_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  my_email text;
  claimed integer;
begin
  select lower(email) into my_email from auth.users where id = auth.uid();
  if my_email is null then return 0; end if;

  update public.workspace_members
  set user_id = auth.uid(),
      status = 'active',
      updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  where lower(email) = my_email
    and user_id is null
    and status = 'invited'
    and deleted_at is null;

  get diagnostics claimed = row_count;
  return claimed;
end $$;

grant execute on function public.claim_workspace_invites() to authenticated;

-- Every new signup needs a personal workspace of their own, or they land in
-- an app with nowhere to put anything. v3 relied on `owner_id default
-- auth.uid()` for this; workspace_id has no such default, so it takes a
-- trigger. Runs on auth.users insert, before the app ever loads.

create or replace function public.ensure_personal_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id text := 'ws-' || replace(new.id::text, '-', '');
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  insert into public.workspaces (id, name, kind, created_by, updated_at, created_at)
  values (ws_id, 'My workspace', 'personal', new.id, now_txt, now_txt)
  on conflict (id) do nothing;

  insert into public.workspace_members
    (id, workspace_id, user_id, email, role, status, invited_by, updated_at, created_at)
  values ('wm-' || replace(new.id::text, '-', ''), ws_id, new.id,
          lower(coalesce(new.email, 'unknown@local')), 'owner', 'active', new.id, now_txt, now_txt)
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created_workspace on auth.users;
create trigger on_auth_user_created_workspace
  after insert on auth.users
  for each row execute function public.ensure_personal_workspace();

-- ============================================================================
-- 6. INDIVIDUAL vs TEAM TASKS
-- ============================================================================
--
-- Until now a task had exactly one assignee_id — one person, always. Team
-- work needs a task that belongs to a group rather than a named individual,
-- and needs the two kinds to be tellable apart when filtering and reporting.
-- `scope` is stored rather than derived from "is assignee_group_id null" so
-- that a team task temporarily assigned to one person for execution is still
-- reported as team work.

alter table public.tasks
  add column if not exists scope text not null default 'individual'
    check (scope in ('individual', 'team'));
alter table public.tasks
  add column if not exists assignee_group_id text references public.member_groups(id);

-- Calendar marking (item 3): a task can be pinned so it stands out on the
-- calendar, with a note saying why and who it is aimed at.
alter table public.tasks
  add column if not exists is_marked integer not null default 0;
alter table public.tasks
  add column if not exists mark_label text;
alter table public.tasks
  add column if not exists mark_scope text
    check (mark_scope is null or mark_scope in ('self', 'member', 'group', 'team'));
alter table public.tasks
  add column if not exists mark_target_id text;

-- ============================================================================
-- 7. LEAVE TRACKING (item 8)
-- ============================================================================
--
-- calendar_exceptions was a two-value column (holiday | travel) enforced by a
-- check constraint created in the original v1 schema — whose name this script
-- cannot assume, so it is found and dropped by inspection rather than by
-- name. Leave differs from a holiday in an important way for reporting: a
-- holiday is the calendar's fault, leave is a person's, and month-end wants
-- them counted separately with a stated reason.

do $$
declare
  con record;
begin
  for con in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'calendar_exceptions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%ex_type%'
  loop
    execute format('alter table public.calendar_exceptions drop constraint %I;', con.conname);
  end loop;
end $$;

alter table public.calendar_exceptions
  add constraint calendar_exceptions_ex_type_check
  check (ex_type in ('holiday', 'travel', 'leave_declared', 'leave_taken'));

-- Why the leave was taken — surfaced in the month-end report grouped by
-- reason, which is the whole point of asking for it.
alter table public.calendar_exceptions
  add column if not exists reason text;
-- Whose leave. Null means "the whole workspace" (a public holiday), which is
-- how every pre-v4 row reads and why this stays nullable.
alter table public.calendar_exceptions
  add column if not exists member_id text references public.team_members(id);
