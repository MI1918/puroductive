-- Puroductive v6 — the notification center + explicit invite accept/decline.
--
-- WHAT CHANGES
-- ------------
-- Until now, being invited was entirely passive: claim_workspace_invites()
-- silently flipped an invite to 'active' the moment the invited email signed
-- in, with no consent step and no visible signal beyond a toast that only
-- fired if you happened to be looking. This migration makes joining a
-- workspace an explicit action, with something durable to act on:
--
--   1. A `notifications` table — persistent, not a toast that vanishes.
--      Each row can point at a task, a project, or a pending invite, so the
--      UI can jump straight to it.
--   2. A trigger that creates an 'invite_pending' notification the moment
--      someone is invited, if their account already exists — no waiting for
--      them to sign in again first.
--   3. claim_workspace_invites() no longer activates anything. It only
--      links a newly-signed-up account to any invites addressed to their
--      email (so the notification trigger above and the accept step below
--      have a user_id to work with) and creates the same notification.
--   4. accept_workspace_invite() / decline_workspace_invite() — the actual
--      join now requires one of these to be called explicitly.
--
-- Run once, after schema_v4.sql and schema_v5.sql. Safe to re-run.

-- ============================================================================
-- 1. NOTIFICATIONS
-- ============================================================================

create table if not exists public.notifications (
  id            text primary key,
  -- Who sees it. Deliberately NOT gated by workspace membership in RLS
  -- (unlike every other table in this app) — the entire point of
  -- 'invite_pending' is to reach someone who is not yet an active member of
  -- the workspace it's about.
  user_id       uuid not null references auth.users(id),
  workspace_id  text references public.workspaces(id),
  kind          text not null
                check (kind in ('invite_pending', 'invite_accepted', 'task_completed', 'project_completed')),
  title         text not null,
  body          text not null default '',
  -- Exactly one of these is set, depending on `kind` — the client uses
  -- whichever is present to know what "jump to it" means.
  action_membership_id text references public.workspace_members(id),
  action_task_id        text references public.tasks(id),
  action_project_id     text references public.projects(id),
  read_at       text,
  -- Swipe-to-dismiss. Tombstoned like everything else in this app, never
  -- hard-deleted.
  dismissed_at  text,
  created_at    text not null
);
create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_user_unread
  on public.notifications (user_id) where dismissed_at is null;

alter table public.notifications enable row level security;

drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "mark own notifications" on public.notifications;
create policy "mark own notifications" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No INSERT policy for `authenticated` — every row is written by the
-- SECURITY DEFINER trigger below, which bypasses RLS entirely by design.
-- Nobody can hand another person a notification directly; it only ever
-- follows from an actual invite.

-- ============================================================================
-- 2. 'declined' — a real end state, distinct from 'removed'
-- ============================================================================
--
-- 'removed' already meant "no longer part of this workspace", but that reads
-- oddly for someone who never joined in the first place. Reporting on "how
-- many invites get turned down" also wants these separable.

do $$
declare
  con record;
begin
  for con in
    select c.conname
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'workspace_members'
      and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.workspace_members drop constraint %I;', con.conname);
  end loop;
end $$;

alter table public.workspace_members
  add constraint workspace_members_status_check
  check (status in ('invited', 'active', 'removed', 'declined'));

-- ============================================================================
-- 3. THE INVITE-PENDING NOTIFICATION TRIGGER
-- ============================================================================
--
-- Fires once, right when an invite is created. If the invited email already
-- has an account, this links it immediately (same linking
-- claim_workspace_invites() does on sign-in — having both means an
-- already-registered person doesn't have to sign out and back in to see the
-- invite) and writes the notification. If the account doesn't exist yet,
-- this does nothing; claim_workspace_invites() picks it up the first time
-- they ever sign in.

create or replace function public.trg_fn_notify_on_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_uid uuid;
  ws_name text;
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if new.status <> 'invited' then return new; end if;

  select id into target_uid from auth.users where lower(email) = lower(new.email);
  if target_uid is null then return new; end if;

  update public.workspace_members set user_id = target_uid where id = new.id and user_id is null;
  select name into ws_name from public.workspaces where id = new.workspace_id;

  insert into public.notifications
    (id, user_id, workspace_id, kind, title, body, action_membership_id, created_at)
  values (
    'nt-' || replace(gen_random_uuid()::text, '-', ''), target_uid, new.workspace_id,
    'invite_pending', 'Invitation to ' || coalesce(ws_name, 'a workspace'),
    'You''ve been invited as ' || new.role || '. Accept to start collaborating.',
    new.id, now_txt
  );
  return new;
end $$;

drop trigger if exists on_workspace_member_invited on public.workspace_members;
create trigger on_workspace_member_invited
  after insert on public.workspace_members
  for each row execute function public.trg_fn_notify_on_invite();

-- ============================================================================
-- 4. claim_workspace_invites() — now links, does not activate
-- ============================================================================
--
-- Same name as before (the client already calls it by this name on every
-- load) but different behavior: it used to flip status straight to 'active'.
-- Now it only attaches user_id, so the invite has an owner to act on it, and
-- writes the same notification the trigger above writes for the
-- already-registered case — this is that same code path for someone who
-- gets invited BEFORE they ever have an account.

create or replace function public.claim_workspace_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  my_email text;
  my_uid uuid := auth.uid();
  linked integer;
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  r record;
begin
  select lower(email) into my_email from auth.users where id = my_uid;
  if my_email is null then return 0; end if;

  for r in
    select id, workspace_id, role
    from public.workspace_members
    where lower(email) = my_email
      and user_id is null
      and status = 'invited'
      and deleted_at is null
  loop
    update public.workspace_members set user_id = my_uid, updated_at = now_txt where id = r.id;
    insert into public.notifications
      (id, user_id, workspace_id, kind, title, body, action_membership_id, created_at)
    select 'nt-' || replace(gen_random_uuid()::text, '-', ''), my_uid, r.workspace_id,
      'invite_pending', 'Invitation to ' || coalesce(w.name, 'a workspace'),
      'You''ve been invited as ' || r.role || '. Accept to start collaborating.',
      r.id, now_txt
    from public.workspaces w where w.id = r.workspace_id
    on conflict do nothing;
  end loop;

  get diagnostics linked = row_count;
  return linked;
end $$;

-- Postgres grants EXECUTE to PUBLIC on every new function by default, which
-- flows through to `anon` regardless of any anon-specific revoke (the exact
-- mistake this project already made once with the invite-member Edge
-- Function's helper RPCs — see schema_v4.sql's section 2 comment). Revoking
-- from PUBLIC and re-granting only to authenticated here from the start.
revoke execute on function public.claim_workspace_invites() from public;
grant execute on function public.claim_workspace_invites() to authenticated;

-- ============================================================================
-- 5. ACCEPT / DECLINE
-- ============================================================================
--
-- Both check user_id = auth.uid() themselves rather than relying only on the
-- notifications RLS policy, because the actual state change happens on
-- workspace_members, a different table with its own policies — this is the
-- one narrow case where a member needs to update a membership row that
-- isn't necessarily their own admin-managed one, so it goes through a
-- SECURITY DEFINER function rather than loosening workspace_members' RLS.

create or replace function public.accept_workspace_invite(p_membership_id text)
returns text  -- the workspace_id, so the client can switch straight to it
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id text;
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  update public.workspace_members
  set status = 'active', updated_at = now_txt
  where id = p_membership_id
    and user_id = auth.uid()
    and status = 'invited'
    and deleted_at is null
  returning workspace_id into ws_id;

  if ws_id is null then
    raise exception 'No pending invite found for you with that id';
  end if;
  return ws_id;
end $$;

create or replace function public.decline_workspace_invite(p_membership_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  affected integer;
begin
  update public.workspace_members
  set status = 'declined', deleted_at = now_txt, updated_at = now_txt
  where id = p_membership_id
    and user_id = auth.uid()
    and status = 'invited'
    and deleted_at is null;

  get diagnostics affected = row_count;
  if affected = 0 then
    raise exception 'No pending invite found for you with that id';
  end if;
end $$;

-- These two are brand-new functions, so — unlike claim_workspace_invites
-- above, which already existed and keeps its prior grants across CREATE OR
-- REPLACE — they pick up Supabase's platform default of an EXPLICIT EXECUTE
-- grant to anon/authenticated at creation. Revoking from PUBLIC alone
-- doesn't touch that explicit per-role grant, so anon and authenticated
-- both have to be named directly.
revoke execute on function public.accept_workspace_invite(text) from anon, authenticated, public;
revoke execute on function public.decline_workspace_invite(text) from anon, authenticated, public;
grant execute on function public.accept_workspace_invite(text) to authenticated;
grant execute on function public.decline_workspace_invite(text) to authenticated;
-- Never called directly — only ever fired by the trigger itself.
revoke execute on function public.trg_fn_notify_on_invite() from anon, authenticated, public;

-- ============================================================================
-- 6. VERIFY
-- ============================================================================

select p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('claim_workspace_invites', 'accept_workspace_invite', 'decline_workspace_invite')
order by p.proname;
