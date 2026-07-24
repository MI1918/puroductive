// Puroductive — google-calendar-cron Edge Function (item 5: true background
// auto-sync, schema_v11.sql).
//
// Invoked every 15 minutes by a pg_cron job (see schema_v11.sql) via
// pg_net's net.http_post — never by a browser. There is no user session in
// this context at all, so instead of verify_jwt this checks the
// `x-cron-secret` header against the same secret pg_cron reads out of
// Supabase Vault: only that scheduled job can ever produce a matching
// header. Runs on the SERVICE ROLE client (bypasses RLS entirely, same
// justification schema_v8.sql already used for the OAuth callback), because
// unlike the manual "Sync now" button, there's no caller whose RLS grant it
// could run under.
//
// Loops every connection with auto_sync = 1 and runs the same pull/push
// logic the manual sync button uses (../_shared/googleSync.ts), isolating
// failures per connection so one broken refresh token doesn't stop the rest
// of the workspaces from syncing.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { syncGoogleConnection } from "../_shared/googleSync.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // The shared secret lives in Vault, not in an Edge Function env var. The
  // 'vault' schema itself isn't exposed over PostgREST for any role, so this
  // goes through the locked-down public.get_google_auto_sync_cron_secret()
  // RPC (schema_v11.sql) instead — SECURITY DEFINER, execute granted only
  // to service_role, which is exactly what this client authenticates as.
  const { data: secret, error: secretErr } = await admin.rpc("get_google_auto_sync_cron_secret");
  if (secretErr || !secret) return json({ error: "Cron secret not configured" }, 500);
  const provided = req.headers.get("x-cron-secret");
  if (!provided || provided !== secret) return json({ error: "Unauthorized" }, 401);

  const { data: connections, error: connErr } = await admin
    .from("google_calendar_connections").select("*").eq("auto_sync", 1).is("deleted_at", null);
  if (connErr) return json({ error: connErr.message }, 500);

  const results: Record<string, unknown> = {};
  for (const conn of connections ?? []) {
    try {
      results[conn.id] = await syncGoogleConnection(admin, conn, googleClientId, googleClientSecret);
    } catch (e) {
      results[conn.id] = { error: (e as Error).message };
    }
  }

  return json({ synced: (connections ?? []).length, results });
});
