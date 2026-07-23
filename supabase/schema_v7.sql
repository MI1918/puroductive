-- Puroductive v7 — team/group chat.
--
-- The last piece of "different workspaces, group/team chat" (item 9) —
-- workspaces landed in schema_v4, this is the chat half. Channels aren't a
-- separate concept: a message with group_id = null is the workspace-wide
-- "General" channel, and a message with group_id set belongs to that
-- existing team_members group. No new "channels" table, because the groups
-- this would otherwise duplicate already exist and are already what people
-- think of as their team.
--
-- Run once, after schema_v4.sql (needs is_workspace_member() /
-- can_write_workspace()). Safe to re-run.

create table if not exists public.chat_messages (
  id                text primary key,
  workspace_id      text not null references public.workspaces(id),
  group_id          text references public.member_groups(id),
  author_id         uuid not null references auth.users(id) default auth.uid(),
  author_member_id  text references public.team_members(id),
  body              text not null,
  version           integer not null default 1,
  updated_at        text not null,
  device_id         text not null default 'app',
  created_at        text not null,
  deleted_at        text
);
create index if not exists idx_chat_messages_channel
  on public.chat_messages (workspace_id, group_id, created_at);

alter table public.chat_messages enable row level security;

drop policy if exists "workspace read" on public.chat_messages;
create policy "workspace read" on public.chat_messages
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace write" on public.chat_messages;
create policy "workspace write" on public.chat_messages
  for insert to authenticated
  with check (public.can_write_workspace(workspace_id));

-- Soft-delete only, and only your own message — same shape as the board's
-- "author edits own post" policy.
drop policy if exists "author deletes own message" on public.chat_messages;
create policy "author deletes own message" on public.chat_messages
  for update to authenticated
  using (author_id = auth.uid() and public.can_write_workspace(workspace_id))
  with check (author_id = auth.uid() and public.can_write_workspace(workspace_id));
