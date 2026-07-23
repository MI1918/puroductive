// Puroductive — google-oauth-start Edge Function
//
// The authenticated half of the OAuth handshake: while we still know who's
// asking (a verified JWT), mint a one-time state token, park it against
// this user + workspace, and hand back the URL to send them to Google.
// google-oauth-callback (unauthenticated — Google's redirect carries no
// Puroductive session) uses that state to recover who this was for.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });

const REDIRECT_URI = "https://pdmhggkiamgodaqhdddd.supabase.co/functions/v1/google-oauth-callback";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let workspaceId: string | undefined;
  try {
    ({ workspaceId } = await req.json());
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!workspaceId) return json({ error: "workspaceId is required" }, 400);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID")!;

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: "Not authenticated" }, 401);

  // Same permission this workspace already uses for everything else — a
  // viewer shouldn't be able to wire up an integration any more than they
  // can add a task.
  const { data: canWrite, error: permErr } = await callerClient.rpc("can_write_workspace", { ws: workspaceId });
  if (permErr) return json({ error: `Could not verify permission: ${permErr.message}` }, 500);
  if (!canWrite) return json({ error: "You don't have write access to this workspace" }, 403);

  const state = crypto.randomUUID();
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error: insertErr } = await adminClient.from("google_oauth_states").insert({
    state, user_id: userRes.user.id, workspace_id: workspaceId,
    created_at: new Date().toISOString(),
  });
  if (insertErr) return json({ error: insertErr.message }, 500);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", googleClientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  // Both required to reliably get a refresh_token back — Google only issues
  // one on first consent unless prompt=consent forces re-consent every time.
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  return json({ authUrl: authUrl.toString() });
});
