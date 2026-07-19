import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

const styles = {
  page: {
    minHeight: "100vh", display: "grid", placeItems: "center",
    background: "#F7F7F4", fontFamily: "'Inter', system-ui, sans-serif", padding: 20,
  },
  card: {
    width: "100%", maxWidth: 380, background: "#FFFFFF", borderRadius: 22, padding: 32,
    border: "1px solid #E9E9E3", boxShadow: "0 2px 4px rgba(22,24,29,0.05), 0 24px 48px -16px rgba(22,24,29,0.14)",
  },
  title: { fontFamily: "'Sora', system-ui, sans-serif", fontSize: 22, fontWeight: 700, margin: "0 0 4px", color: "#16181D" },
  sub: { fontSize: 13, color: "#5A5F69", margin: "0 0 22px", lineHeight: 1.5 },
  label: { display: "block", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9AA0AA", marginBottom: 6 },
  input: {
    width: "100%", minHeight: 44, padding: "0 14px", borderRadius: 12, fontSize: 14,
    border: "1px solid #E9E9E3", marginBottom: 16, boxSizing: "border-box",
  },
  button: {
    width: "100%", minHeight: 46, borderRadius: 12, border: "none", cursor: "pointer",
    background: "#16181D", color: "#FFFFFF", fontSize: 14, fontWeight: 600, marginTop: 4,
  },
  switchRow: { textAlign: "center", marginTop: 18, fontSize: 12.5, color: "#5A5F69" },
  switchLink: { color: "#16181D", fontWeight: 600, cursor: "pointer", background: "none", border: "none", padding: 0, textDecoration: "underline" },
  error: { fontSize: 12.5, color: "#B91C1C", background: "#FDECEA", border: "1px solid #F5C6BE", borderRadius: 10, padding: "10px 12px", marginBottom: 16 },
  notice: { fontSize: 12.5, color: "#3F6212", background: "#F2FADF", border: "1px solid #C9E88A", borderRadius: 10, padding: "10px 12px", marginBottom: 16 },
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
        const { error } = await supabase.auth.signUp({ email, password });
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
