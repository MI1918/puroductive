// Puroductive — invite-member Edge Function
//
// WHY THIS EXISTS
// ----------------
// db.js's inviteToWorkspace() only ever inserted a row into
// workspace_members with status='invited' — nothing was ever emailed to
// anyone. The person had to independently discover Puroductive, sign up on
// their own, and only then did claim_workspace_invites() silently link them
// on their next sign-in. That's not an invite, it's a coincidence with a
// matching email address, and from the admin's side it looked like the
// invite button did nothing at all.
//
// This function sends a REAL email, via Supabase Auth's own admin invite
// API — no third-party email provider needed. Deliberately narrow scope:
// it does exactly one privileged thing (send the invite email) and nothing
// else. The membership row itself is still inserted by the client via
// inviteToWorkspace() BEFORE this is called — see src/lib/db.js's
// sendWorkspaceInviteEmail(), which calls this only after that insert has
// already succeeded. That ordering matters: if the DB insert fails, no
// email goes out; if the email fails after a successful insert, the
// membership row still exists and degrades gracefully to the old silent-
// claim-on-signup behavior rather than being lost.
//
// SECURITY
// --------
// verify_jwt is on (Supabase checks the caller is authenticated before this
// code even runs). On top of that, this checks the caller is actually an
// admin of the workspace they're inviting into, using their own JWT-scoped
// client so the existing is_workspace_admin() RLS helper does the check —
// the same function the database's own RLS policies use, so "who can invite"
// can never drift out of sync between this function and the database.
//
// The service-role key is used for exactly one call:
// auth.admin.inviteUserByEmail(). It is read from Deno.env, which Supabase
// injects automatically into every Edge Function — nothing to configure.

import { createClient } from "jsr:@supabase/supabase-js@2";

const APP_URL = Deno.env.get("APP_URL") ?? "https://mi1918.github.io/puroductive/";

/* Called cross-origin from the browser (mi1918.github.io calling
 * *.supabase.co), so the browser sends a CORS preflight OPTIONS request
 * before the real one. Without these headers the preflight is refused and
 * the browser never even attempts the actual POST — which is exactly what
 * "Failed to send a request to the Edge Function" means: the request never
 * completed, this function's code never ran at all. Wildcard origin is fine
 * here since this endpoint requires a valid signed-in JWT regardless of
 * where the request comes from. */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });

Deno.serve(async (req) => {
  // Preflight — Supabase's gateway exempts OPTIONS from JWT verification
  // specifically so this can succeed before the caller has proven anything.
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let payload: { workspaceId?: string; email?: string; role?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { workspaceId, email, role } = payload;
  if (!workspaceId || !email) return json({ error: "workspaceId and email are required" }, 400);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Scoped to the caller's own session — RLS applies exactly as it would to
  // any request the app itself makes, which is what lets is_workspace_admin
  // below be trusted.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userRes, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: "Not authenticated" }, 401);

  const { data: isAdmin, error: adminErr } = await callerClient.rpc("is_workspace_admin", { ws: workspaceId });
  if (adminErr) return json({ error: `Could not verify permission: ${adminErr.message}` }, 500);
  if (!isAdmin) return json({ error: "Only workspace owners/admins can send invites" }, 403);

  const { data: wsRow } = await callerClient.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
  const workspaceName = wsRow?.name ?? "a Puroductive workspace";

  // The only step that needs elevated privilege. Built fresh, used once —
  // never handed to the caller, never reused for anything else in this
  // function.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: APP_URL,
    data: { invitedToWorkspaceId: workspaceId, invitedToWorkspaceName: workspaceName, invitedRole: role ?? "member" },
  });

  if (inviteErr) {
    // Someone who already has an account can't be "invited" again through
    // this API — Supabase Auth refuses with this exact wording. That's not
    // a failure from the app's point of view: they already exist, so the
    // membership row inserted before this call fires will link up
    // automatically via claim_workspace_invites() the next time they sign
    // in, same as it always did. Tell the caller that plainly rather than
    // surfacing it as an error.
    if (/already been registered|already registered|already exists/i.test(inviteErr.message)) {
      return json({ ok: true, alreadyHadAccount: true });
    }
    return json({ error: inviteErr.message }, 502);
  }

  return json({ ok: true, alreadyHadAccount: false });
});
