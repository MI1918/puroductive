import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { getInitialTheme, applyTheme } from "../lib/theme.js";

/* Every color here is a CSS variable, not a literal — see src/lib/theme.js.
 * That's what makes dark mode apply to the sign-in screen automatically
 * without this file needing its own light/dark branching logic. */
const styles = {
  page: {
    minHeight: "100vh", display: "grid", placeItems: "center",
    background: "var(--bg)", fontFamily: "'Inter', system-ui, sans-serif", padding: 20,
  },
  card: {
    width: "100%", maxWidth: 380, background: "var(--card)", borderRadius: 22, padding: 32,
    border: "1px solid var(--line)", boxShadow: "var(--shadow-lg)", position: "relative",
  },
  themeToggle: {
    position: "absolute", top: 16, right: 16, width: 34, height: 34, borderRadius: 10,
    border: "1px solid var(--line)", background: "var(--card-soft)", cursor: "pointer",
    display: "grid", placeItems: "center", fontSize: 15, lineHeight: 1,
  },
  title: { fontFamily: "'Sora', system-ui, sans-serif", fontSize: 22, fontWeight: 700, margin: "0 0 4px", color: "var(--ink)" },
  sub: { fontSize: 13, color: "var(--ink2)", margin: "0 0 22px", lineHeight: 1.5 },
  label: { display: "block", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 6 },
  input: {
    width: "100%", minHeight: 44, padding: "0 14px", borderRadius: 12, fontSize: 14,
    border: "1px solid var(--line)", marginBottom: 16, boxSizing: "border-box",
    background: "var(--card)", color: "var(--ink)",
  },
  button: {
    width: "100%", minHeight: 46, borderRadius: 12, border: "none", cursor: "pointer",
    /* Deliberately literal, not var(--ink) — this is a fixed "always dark
     * surface" button style, and var(--ink) flips to a LIGHT color in dark
     * mode, which would turn this into a light button with invisible white
     * text on it. See the identical note on Btn's `ink` variant in App.jsx. */
    background: "#16181D", color: "#FFFFFF", fontSize: 14, fontWeight: 600, marginTop: 4,
  },
  switchRow: { textAlign: "center", marginTop: 18, fontSize: 12.5, color: "var(--ink2)" },
  switchLink: { color: "var(--ink)", fontWeight: 600, cursor: "pointer", background: "none", border: "none", padding: 0, textDecoration: "underline" },
  error: { fontSize: 12.5, color: "var(--danger)", background: "var(--danger-bg)", border: "1px solid var(--danger-line)", borderRadius: 10, padding: "10px 12px", marginBottom: 16 },
  notice: { fontSize: 12.5, color: "var(--lime-deep)", background: "var(--card-soft)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", marginBottom: 16 },
};

const ThemeToggle = () => {
  const [colorMode, setColorMode] = useState(getInitialTheme);
  const flip = () => {
    const next = colorMode === "dark" ? "light" : "dark";
    setColorMode(next);
    applyTheme(next);
  };
  return (
    <button type="button" style={styles.themeToggle} onClick={flip}
      aria-label={colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
      {colorMode === "dark" ? "☀️" : "🌙"}
    </button>
  );
};

const LoginForm = () => {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
        });
        if (error) throw error;
        setNotice("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={submit}>
        <ThemeToggle />
        <h1 style={styles.title}>Puroductive</h1>
        <p style={styles.sub}>{mode === "signin" ? "Sign in to your workspace." : "Create your workspace account."}</p>
        {error && <div style={styles.error}>{error}</div>}
        {notice && <div style={styles.notice}>{notice}</div>}
        <label style={styles.label}>Email</label>
        <input style={styles.input} type="email" required autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <label style={styles.label}>Password</label>
        <input style={styles.input} type="password" required minLength={6}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        <button style={{ ...styles.button, opacity: busy ? 0.6 : 1 }} type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
        </button>
        <div style={styles.switchRow}>
          {mode === "signin" ? (
            <>No account yet? <button type="button" style={styles.switchLink} onClick={() => setMode("signup")}>Sign up</button></>
          ) : (
            <>Already have an account? <button type="button" style={styles.switchLink} onClick={() => setMode("signin")}>Sign in</button></>
          )}
        </div>
      </form>
    </div>
  );
};

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div style={styles.page} />;
  if (!session) return <LoginForm />;
  return children(session);
}
