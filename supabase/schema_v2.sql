-- Puroductive v2 — Companies/Team management + Calendar events.
--
-- Adds what v1 was missing: team-member category groups, and a calendar
-- events table (meetings/visits) that sits alongside the existing task and
-- project deadlines. Companies and team members themselves needed no schema
-- change — they already have deleted_at and are already read by
-- fetchBootstrap(); v1 just never shipped a UI to write them.
--
-- Run this once in the Supabase SQL editor (Project -> SQL Editor -> New
-- query), after rls.sql has already been run. Safe to re-run.

create table if not exists public.member_groups (
  id          text primary key,
  name        text not null,
  sort_order  integer not null default 0,
  version     integer not null default 1,
  updated_at  text not null,
  device_id   text not null,
  created_at  text not null,
  deleted_at  text
);

alter table public.team_members
  add column if not exists group_id text references public.member_groups(id);

-- Attendees are packed as a JSON array of team_member ids (attendee_ids_json),
-- the same "pack it as JSON text" approach team_members.roles_json already
-- uses — nothing in this app queries "which events is member X in" from the
-- member side, so a join table would be unused abstraction.
create table if not exists public.calendar_events (
  id                 text primary key,
  title              text not null,
  event_type         text not null default 'meeting' check (event_type in ('meeting','visit','other')),
  event_date         text not null,        -- YYYY-MM-DD
  start_time         text,                 -- HH:MM, optional
  end_time           text,                 -- HH:MM, optional
  company_id         text references public.companies(id),
  project_id         text references public.projects(id),
  location           text,
  notes              text,
  attendee_ids_json  text not null default '[]',
  version            integer not null default 1,
  updated_at         text not null,
  device_id          text not null,
  created_at         text not null,
  deleted_at         text
);
create index if not exists idx_calendar_events_date on public.calendar_events(event_date);

-- Same "any signed-in user, full access" policy as every other table (see rls.sql).
do $$
declare
  t text;
begin
  for t in select unnest(array['member_groups', 'calendar_events'])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "authenticated full access" on public.%I;', t);
    execute format(
      'create policy "authenticated full access" on public.%I for all to authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;
