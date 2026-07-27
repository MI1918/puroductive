-- Puroductive v13 — company & project drag-reorder (item 2).
--
-- Companies already have Edit/Delete; projects had neither edit, delete,
-- nor reorder UI. Both get a manual sort position here, same fractional
-- scheme as tasks.queue_order/personal_queue_order (schema_v9) — dragging
-- one row only ever touches that one row's value.
--
-- Deletion needs no schema change: both tables already have deleted_at,
-- soft-deleted the same way every other table in this app is.
--
-- Run once, after schema_v4.sql. Safe to re-run.

alter table public.companies add column if not exists sort_order double precision;
alter table public.projects add column if not exists sort_order double precision;

create index if not exists idx_companies_sort_order on public.companies (workspace_id, sort_order);
create index if not exists idx_projects_sort_order on public.projects (workspace_id, sort_order);
