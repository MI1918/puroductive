// Puroductive — clock-webhook Edge Function (item 1: Samsung Routines /
// Apple Shortcuts geofence clock-in/out automation).
//
// Called by a phone automation, not a signed-in browser — there is no
// Supabase session to attach, so this authenticates purely off an opaque
// personal token (schema_v10.sql's automation_tokens) instead of a JWT.
// GET, with `token` and `action` as query params, specifically so a
// Shortcuts "Get Contents of URL" action or a Tasker/Automate/IFTTT HTTP
// block can call it with zero body-construction. Runs on the SERVICE ROLE
// client — same reasoning as google-calendar-cron: there's no caller whose
// RLS grant this could run under.
//
// Does exactly what the manual Clock In / Clock Out buttons already do
// (App.jsx's clockIn/clockOut, backed by work_sessions) — one open
// (logout_at is null) session per workspace at a time, same as today.
// Idempotent both directions: a repeat "in" while already clocked in, or
// "out" while already clocked out, is a no-op rather than an error — a
// flaky/duplicate geofence retrigger shouldn't create a second session or
// blow away the existing one.

import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const action = url.searchParams.get("action");
  if (!token) return json({ error: "token is required" }, 400);
  if (action !== "in" && action !== "out") return json({ error: "action must be 'in' or 'out'" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const tokenHash = await sha256Hex(token);
  const { data: tokenRow, error: tokenErr } = await admin.from("automation_tokens")
    .select("*").eq("token_hash", tokenHash).is("revoked_at", null).maybeSingle();
  if (tokenErr) return json({ error: tokenErr.message }, 500);
  if (!tokenRow) return json({ error: "Invalid or revoked token" }, 401);

  const now = new Date().toISOString();
  admin.from("automation_tokens").update({ last_used_at: now }).eq("id", tokenRow.id).then(() => {});

  const { data: openSession, error: openErr } = await admin.from("work_sessions")
    .select("*").eq("workspace_id", tokenRow.workspace_id).is("logout_at", null).is("deleted_at", null)
    .order("login_at", { ascending: false }).limit(1).maybeSingle();
  if (openErr) return json({ error: openErr.message }, 500);

  if (action === "in") {
    if (openSession) return json({ ok: true, state: "in", note: "already clocked in" });
    const { error } = await admin.from("work_sessions").insert({
      id: crypto.randomUUID(), login_at: now, logout_at: null,
      workspace_id: tokenRow.workspace_id, owner_id: tokenRow.user_id,
      updated_at: now, created_at: now, device_id: "clock-webhook",
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, state: "in" });
  }

  if (!openSession) return json({ ok: true, state: "out", note: "already clocked out" });
  const { error } = await admin.from("work_sessions")
    .update({ logout_at: now, updated_at: now, device_id: "clock-webhook" }).eq("id", openSession.id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, state: "out" });
});
