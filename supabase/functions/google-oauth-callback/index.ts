// Puroductive — google-oauth-callback Edge Function
//
// Google redirects the browser straight here after consent — there is no
// Puroductive Authorization header on this request, which is exactly why
// google-oauth-start had to stash a state token against a user id first.
// This function's whole job: recover that user from `state`, exchange the
// one-time code for a refresh token, store it, and bounce the browser back
// into the app. Deployed with verify_jwt=false — the JWT gate would reject
// Google's redirect outright, since it never carries one.

import { createClient } from "jsr:@supabase/supabase-js@2";

const REDIRECT_URI = "https://pdmhggkiamgodaqhdddd.supabase.co/functions/v1/google-oauth-callback";
const APP_URL = Deno.env.get("APP_URL") ?? "https://mi1918.github.io/puroductive/";
const STATE_MAX_AGE_MS = 15 * 60 * 1000; // a state token older than this is refused

const appRedirect = (params: Record<string, string>) => {
  const url = new URL(APP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url.toString(), 302);
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  if (err) return appRedirect({ google: "error", reason: err });
  if (!code || !state) return appRedirect({ google: "error", reason: "missing_code_or_state" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Single-use: fetch and immediately delete, so a replayed/reused state
  // can't be exchanged twice.
  const { data: stateRow, error: stateErr } = await admin
    .from("google_oauth_states").select("*").eq("state", state).maybeSingle();
  if (stateErr || !stateRow) return appRedirect({ google: "error", reason: "invalid_state" });
  await admin.from("google_oauth_states").delete().eq("state", state);

  if (Date.now() - new Date(stateRow.created_at).getTime() > STATE_MAX_AGE_MS) {
    return appRedirect({ google: "error", reason: "state_expired" });
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: googleClientId, client_secret: googleClientSecret,
      redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok) {
    return appRedirect({ google: "error", reason: tokens.error ?? "token_exchange_failed" });
  }
  if (!tokens.refresh_token) {
    // Shouldn't happen with access_type=offline + prompt=consent, but if
    // Google ever omits it there is nothing useful to store — a connection
    // without a refresh token can't sync in the background at all.
    return appRedirect({ google: "error", reason: "no_refresh_token" });
  }

  // Best-effort — a connection still works without knowing the email, this
  // is only for showing "connected as x@gmail.com" in the UI.
  let googleEmail: string | null = null;
  try {
    const who = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (who.ok) googleEmail = (await who.json()).email ?? null;
  } catch { /* not fatal */ }

  const now = new Date().toISOString();
  const { error: upsertErr } = await admin.from("google_calendar_connections").upsert({
    id: `gc-${stateRow.user_id}-${stateRow.workspace_id}`,
    user_id: stateRow.user_id, workspace_id: stateRow.workspace_id,
    google_email: googleEmail, refresh_token: tokens.refresh_token,
    calendar_id: "primary",
    sync_token: null, // fresh connection — next sync does a full pull, not incremental
    connected_at: now, updated_at: now, created_at: now, deleted_at: null,
  }, { onConflict: "id" });
  if (upsertErr) return appRedirect({ google: "error", reason: "store_failed" });

  return appRedirect({ google: "connected" });
});
