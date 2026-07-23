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
// SCOPE
// -----
// Pull (Google → Puroductive): full two-way for single and recurring
// events — singleEvents=true asks Google to expand recurring events into
// individual instances itself, so there's no RRULE parsing to do here; each
// instance just becomes its own calendar_events row, matching how
// Puroductive already models events (no recurrence concept of its own).
// Deletions on the Google side (status: 'cancelled') soft-delete the linked
// row.
//
// Push (Puroductive → Google): only NEW events (no google_event_id yet) get
// created in Google. Edits made in Puroductive to an already-linked event
// are not currently re-pushed — pull handles updates via Google's
// incremental sync, push doesn't have the equivalent yet. Documented
// limitation, not an oversight; re-push-on-edit is a reasonable follow-up
// once this baseline is confirmed working.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });

async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description ?? data.error ?? "Failed to refresh Google access token");
  return data.access_token as string;
}

/* Google's start/end come as either {date: 'YYYY-MM-DD'} (all-day) or
 * {dateTime: ISO, timeZone}. Puroductive's calendar_events store a bare
 * date plus optional HH:MM start/end — no timezone field at all, so a
 * timed event's clock time is taken as-is (the same simplification the
 * rest of this app already makes; nothing here currently reasons about
 * timezones). */
function fromGoogleTime(t: { date?: string; dateTime?: string }) {
  if (t.date) return { date: t.date, time: null };
  if (t.dateTime) {
    const d = new Date(t.dateTime);
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  }
  return { date: null, time: null };
}

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

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(conn.refresh_token, googleClientId, googleClientSecret);
  } catch (e) {
    return json({ error: `Could not refresh Google access: ${(e as Error).message}` }, 502);
  }

  // ---------------------------------- PULL ----------------------------------
  let pulled = 0, deleted = 0;
  let syncToken = conn.sync_token as string | null;
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;

  const baseParams: Record<string, string> = { singleEvents: "true", maxResults: "250" };
  if (syncToken) {
    baseParams.syncToken = syncToken;
  } else {
    // First sync for this connection — bounded window rather than the
    // account's entire history, matching the app's own agenda horizon.
    const now = new Date();
    const future = new Date(Date.now() + 90 * 864e5);
    baseParams.timeMin = now.toISOString();
    baseParams.timeMax = future.toISOString();
  }

  do {
    const listUrl = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(conn.calendar_id)}/events`);
    for (const [k, v] of Object.entries(baseParams)) listUrl.searchParams.set(k, v);
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (listRes.status === 410) {
      // Sync token expired/invalid on Google's side — the only recovery is
      // a fresh full sync, so drop it and stop this run; the next poll
      // picks up as a first sync.
      await db.from("google_calendar_connections").update({ sync_token: null, updated_at: new Date().toISOString() }).eq("id", conn.id);
      return json({ error: "Google sync token expired — will do a fresh full sync next time", pulled: 0, pushed: 0 }, 200);
    }
    const list = await listRes.json();
    if (!listRes.ok) return json({ error: list.error?.message ?? "Google Calendar list request failed" }, 502);

    for (const ev of list.items ?? []) {
      if (ev.status === "cancelled") {
        const { error } = await db.from("calendar_events")
          .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("workspace_id", workspaceId).eq("google_event_id", ev.id).is("deleted_at", null);
        if (!error) deleted++;
        continue;
      }
      const start = fromGoogleTime(ev.start ?? {});
      if (!start.date) continue; // no usable date — skip rather than guess
      const end = fromGoogleTime(ev.end ?? {});
      const now = new Date().toISOString();
      const { error } = await db.from("calendar_events").upsert({
        id: `gev-${ev.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60),
        workspace_id: workspaceId, google_event_id: ev.id,
        title: ev.summary || "(untitled)", event_type: "other",
        event_date: start.date, start_time: start.time, end_time: end.time,
        location: ev.location || null, notes: ev.description || null,
        attendee_ids_json: "[]", updated_at: now, created_at: now, device_id: "google-sync",
      }, { onConflict: "workspace_id,google_event_id" });
      if (!error) pulled++;
    }

    pageToken = list.nextPageToken ?? null;
    if (list.nextSyncToken) nextSyncToken = list.nextSyncToken;
  } while (pageToken);

  // ---------------------------------- PUSH ----------------------------------
  let pushed = 0;
  const { data: unpushed } = await db.from("calendar_events")
    .select("*").eq("workspace_id", workspaceId).is("google_event_id", null).is("deleted_at", null).limit(50);

  for (const localEv of unpushed ?? []) {
    const body: Record<string, unknown> = {
      summary: localEv.title,
      location: localEv.location || undefined,
      description: localEv.notes || undefined,
    };
    if (localEv.start_time) {
      body.start = { dateTime: `${localEv.event_date}T${localEv.start_time}:00` };
      body.end = { dateTime: `${localEv.event_date}T${localEv.end_time || localEv.start_time}:00` };
    } else {
      body.start = { date: localEv.event_date };
      // Google's all-day "end.date" is exclusive — the day after, for a
      // single-day event.
      const endDate = new Date(localEv.event_date + "T00:00:00");
      endDate.setDate(endDate.getDate() + 1);
      body.end = { date: endDate.toISOString().slice(0, 10) };
    }

    const createRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(conn.calendar_id)}/events`,
      { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    const created = await createRes.json();
    if (createRes.ok) {
      await db.from("calendar_events").update({ google_event_id: created.id, updated_at: new Date().toISOString() }).eq("id", localEv.id);
      pushed++;
    }
  }

  await db.from("google_calendar_connections").update({
    sync_token: nextSyncToken ?? syncToken, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", conn.id);

  return json({ pulled, deleted, pushed });
});
