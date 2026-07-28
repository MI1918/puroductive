-- Puroductive v14 — Batch 3: ad-hoc/DM chat + message pinning (items 6, 8, 16).
--
-- WHAT THIS ADDS
-- --------------
-- schema_v7's chat deliberately had no "channels" table — group_id already
-- meant "channel" for department chat, and General (group_id null) covered
-- the rest. That still can't express a private conversation restricted to
-- a hand-picked set of people (a "new chat" with specific members, or a
-- 1:1 "whisper") — General and department channels are visible to everyone
-- in scope by design. This adds exactly that, as a second, independent
-- scoping axis:
--
-- 1. chat_channels — an ad-hoc or DM conversation. is_dm distinguishes a
--    1:1 from a named group. Unlike General/department channels, a
--    chat_channel is only visible to its listed participants — enforced by
--    chat_channel_members + is_chat_channel_member(), not by workspace
--    membership alone.
-- 2. chat_channel_members — who's in it. Carries both member_id (the
--    roster identity, for display) and user_id (who actually needs read
--    access) — participants are only ever added from people who already
--    have an account (workspace_members.user_id is not null), since
--    someone with no login could never read a private channel anyway.
-- 3. chat_messages.channel_id — a message belongs to at most one of
--    group_id (existing) or channel_id (new); both null still means
--    General. The existing "workspace read"/"workspace write" policies are
--    replaced with versions that additionally require channel membership
--    when channel_id is set — General/department messages are completely
--    unaffected (channel_id is null for those, so the added clause is a
--    no-op).
-- 4. chat_messages.pinned/pin_note — same idea as posts.pinned (schema_v5),
--    for a chat message. Pinning goes through toggle_chat_message_pin()
--    rather than a raw UPDATE, so "who can pin" (any workspace writer) can
--    be broader than "who can delete" (the author only, via the existing
--    "author deletes own message" policy) without a second UPDATE policy
--    accidentally widening who can edit a message's body or soft-delete it.
--
-- Run once, after schema_v13.sql. Safe to re-run.

-- ============================================================================
-- 1. chat_channels / chat_channel_members
-- ============================================================================

create table if not exists public.chat_channels (
  id           text primary key,
  workspace_id text not null references public.workspaces(id),
  company_id   text references public.companies(id),
  name         text,
  is_dm        boolean not null default false,
  created_by   uuid references auth.users(id),
  updated_at   text not null,
  created_at   text not null,
  deleted_at   text
);

create table if not exists public.chat_channel_members (
  id           text primary key,
  channel_id   text not null references public.chat_channels(id),
  workspace_id text not null references public.workspaces(id),
  member_id    text not null references public.team_members(id),
  user_id      uuid not null references auth.users(id),
  created_at   text not null
);
create index if not exists idx_chat_channel_members_channel on public.chat_channel_members (channel_id);
create index if not exists idx_chat_channel_members_user on public.chat_channel_members (user_id);

-- security definer + stable, same shape as is_workspace_member/can_write_workspace
-- (schema_v4) — the one helper every RLS policy below reuses rather than
-- inlining the same subquery repeatedly.
create or replace function public.is_chat_channel_member(p_channel_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chat_channel_members ccm
    where ccm.channel_id = p_channel_id and ccm.user_id = auth.uid()
  );
$$;
revoke execute on function public.is_chat_channel_member(text) from anon, public;
grant execute on function public.is_chat_channel_member(text) to authenticated;

alter table public.chat_channels enable row level security;

drop policy if exists "channel members can read" on public.chat_channels;
create policy "channel members can read" on public.chat_channels
  for select to authenticated
  using (public.is_chat_channel_member(id));

drop policy if exists "workspace writers can create channels" on public.chat_channels;
create policy "workspace writers can create channels" on public.chat_channels
  for insert to authenticated
  with check (public.can_write_workspace(workspace_id));

alter table public.chat_channel_members enable row level security;

drop policy if exists "channel members can read roster" on public.chat_channel_members;
create policy "channel members can read roster" on public.chat_channel_members
  for select to authenticated
  using (public.is_chat_channel_member(channel_id));

drop policy if exists "workspace writers can add members" on public.chat_channel_members;
create policy "workspace writers can add members" on public.chat_channel_members
  for insert to authenticated
  with check (public.can_write_workspace(workspace_id));

-- ============================================================================
-- 2. chat_messages — channel_id + pinned/pin_note
-- ============================================================================

alter table public.chat_messages add column if not exists channel_id text references public.chat_channels(id);
alter table public.chat_messages add column if not exists pinned boolean not null default false;
alter table public.chat_messages add column if not exists pin_note text;
create index if not exists idx_chat_messages_channel_id on public.chat_messages (channel_id, created_at);

drop policy if exists "workspace read" on public.chat_messages;
create policy "workspace read" on public.chat_messages
  for select to authenticated
  using (public.is_workspace_member(workspace_id) and (channel_id is null or public.is_chat_channel_member(channel_id)));

drop policy if exists "workspace write" on public.chat_messages;
create policy "workspace write" on public.chat_messages
  for insert to authenticated
  with check (public.can_write_workspace(workspace_id) and (channel_id is null or public.is_chat_channel_member(channel_id)));

-- "author deletes own message" (soft-delete) is untouched — still author-only.

-- ============================================================================
-- 3. toggle_chat_message_pin — the one write path for pinned/pin_note
-- ============================================================================

create or replace function public.toggle_chat_message_pin(p_message_id text, p_pinned boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ws text;
begin
  select workspace_id into ws from public.chat_messages where id = p_message_id and deleted_at is null;
  if ws is null then
    raise exception 'Message not found';
  end if;
  if not public.can_write_workspace(ws) then
    raise exception 'Not permitted';
  end if;

  update public.chat_messages
  set pinned = p_pinned, pin_note = case when p_pinned then p_note else null end,
      updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  where id = p_message_id;
end $$;

revoke execute on function public.toggle_chat_message_pin(text, boolean, text) from anon, authenticated, public;
grant execute on function public.toggle_chat_message_pin(text, boolean, text) to authenticated;

-- ============================================================================
-- 4. VERIFY
-- ============================================================================

select p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('is_chat_channel_member', 'toggle_chat_message_pin')
order by p.proname;
