-- Puroductive v17 — "ask an admin" for Google Calendar access (item 3
-- follow-up).
--
-- The 403/"Access blocked" a teammate hits isn't a Puroductive error — it's
-- Google's OAuth consent screen rejecting anyone not on its test-user list
-- — but from the teammate's seat it just looks broken. This gives them a
-- one-click way to tell the person who actually can fix it (the workspace
-- owner/admin), through the same notification center invites already use,
-- rather than a static hint they have to notice and act on unprompted.
--
-- Run once, after schema_v6.sql. Safe to re-run.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('invite_pending', 'invite_accepted', 'task_completed', 'project_completed', 'google_access_requested'));

create or replace function public.request_google_calendar_access(p_workspace_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_email text;
  requester_uid uuid := auth.uid();
  ws_name text;
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  inserted integer;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not a member of this workspace';
  end if;

  select lower(email) into requester_email from auth.users where id = requester_uid;
  select name into ws_name from public.workspaces where id = p_workspace_id;

  insert into public.notifications
    (id, user_id, workspace_id, kind, title, body, created_at)
  select
    'nt-' || replace(gen_random_uuid()::text, '-', ''), wm.user_id, p_workspace_id,
    'google_access_requested', 'Google Calendar access requested',
    coalesce(requester_email, 'A teammate') || ' wants to connect Google Calendar for "' ||
      coalesce(ws_name, 'this workspace') ||
      '" but hasn''t been added as a Google test user yet. Add them in Google Cloud Console → OAuth consent screen → Audience → Test users, then let them know.',
    now_txt
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.role in ('owner', 'admin')
    and wm.status = 'active'
    and wm.user_id is not null
    and wm.user_id <> requester_uid;

  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke execute on function public.request_google_calendar_access(text) from anon, authenticated, public;
grant execute on function public.request_google_calendar_access(text) to authenticated;
