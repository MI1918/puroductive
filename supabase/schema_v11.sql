-- Puroductive v11 — Google Calendar true background auto-sync (item 5).
--
-- WHAT THIS ADDS
-- --------------
-- 1. google_calendar_connections.auto_sync — a per-connection opt-in flag.
--    Owned by the same "disconnect own connection" UPDATE policy schema_v8
--    already created (it lets the connection's owner update their own row
--    with no column restriction), so no new RLS is needed here.
--
-- 2. pg_cron + pg_net — both already available on this project (confirmed
--    via list_extensions), just not yet enabled. This is what lets sync
--    keep running even when nobody has the app open, unlike the existing
--    3-minute while-the-tab-is-open poll in App.jsx, which stays as-is.
--
-- 3. A Vault secret ('google_auto_sync_cron_secret') shared between the
--    cron job and the new google-calendar-cron Edge Function. The cron job
--    reads it directly via SQL (pg_cron runs inside Postgres, so it can
--    query vault.decrypted_secrets straight up). The Edge Function can't do
--    that the same way — it only has a supabase-js/PostgREST client, and
--    the 'vault' schema is never exposed over PostgREST regardless of role
--    — so it instead calls the locked-down RPC
--    public.get_google_auto_sync_cron_secret() below (SECURITY DEFINER,
--    execute revoked from anon/authenticated, granted only to
--    service_role) and compares the result to the request header the cron
--    job sends. Nobody except this database's own scheduled job can ever
--    produce a matching header. Storing the secret in Vault (rather than
--    pasting it into the cron.schedule command's plaintext SQL) keeps it
--    out of pg_stat_statements / cron.job_run_details history.
--
-- Run once, after schema_v8.sql. Safe to re-run — cron.schedule() with an
-- existing job name replaces that job's schedule/command rather than
-- duplicating it, and the secret is only generated once (guarded below).

alter table public.google_calendar_connections add column if not exists auto_sync integer not null default 0;

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- One-time secret generation — guarded so re-running this file doesn't
-- rotate the secret out from under an already-configured Edge Function.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'google_auto_sync_cron_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'google_auto_sync_cron_secret',
      'Shared secret between pg_cron and the google-calendar-cron Edge Function'
    );
  end if;
end $$;

-- Locked-down RPC the Edge Function calls (as service_role) to read the
-- secret above through PostgREST, since the 'vault' schema itself isn't
-- exposed there.
create or replace function public.get_google_auto_sync_cron_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'google_auto_sync_cron_secret';
$$;
revoke all on function public.get_google_auto_sync_cron_secret() from public;
revoke all on function public.get_google_auto_sync_cron_secret() from anon;
revoke all on function public.get_google_auto_sync_cron_secret() from authenticated;
grant execute on function public.get_google_auto_sync_cron_secret() to service_role;

select cron.schedule(
  'puroductive-google-auto-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://pdmhggkiamgodaqhdddd.supabase.co/functions/v1/google-calendar-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'google_auto_sync_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
