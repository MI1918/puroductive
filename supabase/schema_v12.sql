-- Puroductive v12 — fix stale invite_pending notifications (item 1).
--
-- WHAT THIS FIXES
-- ---------------
-- accept_workspace_invite()/decline_workspace_invite() only succeed while
-- the target workspace_members row is still status='invited'. If that row
-- is later removed (or a re-invite creates a new row for the same email)
-- before the person acts on their notification, the old invite_pending
-- notification is never cleaned up — it just sits there, and clicking
-- Accept on it always throws "No pending invite found for you with that
-- id". This is the "notifications are coming but I can't accept it" bug.
--
-- Fix: whenever a workspace_members row leaves status='invited' for any
-- reason, dismiss any of that person's still-undismissed invite_pending
-- notifications pointing at it. Going forward this can never happen again;
-- also backfills the notifications already stuck in this state today.
--
-- Run once, after schema_v6.sql. Safe to re-run.

create or replace function public.trg_fn_dismiss_stale_invite_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  now_txt text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  if old.status = 'invited' and new.status <> 'invited' then
    update public.notifications
    set dismissed_at = now_txt
    where action_membership_id = new.id
      and kind = 'invite_pending'
      and dismissed_at is null;
  end if;
  return new;
end $$;

drop trigger if exists on_workspace_member_status_change on public.workspace_members;
create trigger on_workspace_member_status_change
  after update on public.workspace_members
  for each row execute function public.trg_fn_dismiss_stale_invite_notification();

revoke execute on function public.trg_fn_dismiss_stale_invite_notification() from anon, authenticated, public;

-- Backfill: dismiss any notifications already stuck in this state today.
update public.notifications n
set dismissed_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
from public.workspace_members wm
where n.action_membership_id = wm.id
  and n.kind = 'invite_pending'
  and n.dismissed_at is null
  and wm.status <> 'invited';

-- VERIFY — should return 0.
select count(*) as still_stale
from public.notifications n
join public.workspace_members wm on wm.id = n.action_membership_id
where n.kind = 'invite_pending' and n.dismissed_at is null and wm.status <> 'invited';
