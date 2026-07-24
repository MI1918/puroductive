// Puroductive — google-calendar-sync Edge Function
//
// Everything this function needs is already covered by the caller's own
// RLS: reading their own google_calendar_connections row, reading/writing
// calendar_events in a workspace they can write to. So unlike the OAuth
// functions, this one runs entirely on the CALLER's own JWT-scoped client —
// no service role at all. The only privileged input is GOOGLE_CLIENT_SECRET
// from env, needed to refresh the access token, which is a function-level
// secret unrelated to which Supabase client is in use.
//
// The actual pull/push body lives in ../_shared/googleSync.ts — the new
// google-calendar-cron function (schema_v11.sql's background auto-sync)
// calls the same code on the service-role client, one connection at a time,
// on a schedule.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { syncGoogleConnection } from "../_shared/googleSync.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let workspaceId: string | undefined;
  try { ({ workspaceId } = await req.json()); } catch { return json({ error: "Invalid JSON body" }, 400); }
  if (!workspaceId) return json({ error: "workspaceId is required" }, 400);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  const db = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes, error: userErr } = await db.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: "Not authenticated" }, 401);

  const { data: conn, error: connErr } = await db.from("google_calendar_connections")
    .select("*").eq("workspace_id", workspaceId).eq("user_id", userRes.user.id).is("deleted_at", null).maybeSingle();
  if (connErr) return json({ error: connErr.message }, 500);
  if (!conn) return json({ error: "Google Calendar isn't connected for this workspace" }, 404);

  try {
    const result = await syncGoogleConnection(db, conn, googleClientId, googleClientSecret);
    return json(result);
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
