-- Puroductive v14 — task deadlines can carry a time of day (items 4 & 5).
--
-- Task deadlines already render on the calendar (day dots, Upcoming panel,
-- day detail) for whoever they're assigned to — that part already worked.
-- What was missing: nowhere to put "1pm" on a task like "join the client
-- meet tomorrow at 1pm", so it could only ever show as a same-day dot, not
-- a properly timed entry. deadline_time is optional (HH:MM, 24h) — a task
-- with no time keeps behaving exactly as it does today.
--
-- Run once, after schema_v4.sql. Safe to re-run.

alter table public.tasks add column if not exists deadline_time text;
