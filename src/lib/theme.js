/* ============================================================================
 * THEME — light/dark as real CSS custom properties, not React state threaded
 * through every component.
 *
 * The alternative (a ThemeContext every one of the ~50 components in App.jsx
 * reads from) would mean touching nearly every line of a 3,000-line file to
 * add dark mode. Instead: every color in App.jsx's `T` token object and
 * AuthGate's `styles` object already resolves to a CSS variable string
 * (`var(--ink)` etc.) rather than a literal hex value, and toggling the
 * `data-theme` attribute on <html> flips every one of them at once, for
 * free, in both the authenticated app and the sign-in screen — no re-render
 * needed, no context, no prop drilling.
 * ==========================================================================*/

export const THEME_STORAGE_KEY = "pd.theme";

/* :root = light (the default, no attribute needed), :root[data-theme="dark"]
 * overrides. Rendered once, at the very top of the tree, before AuthGate or
 * the main app — so dark mode works on the sign-in screen too, not just once
 * you're in. */
export const THEME_CSS = `
  /* Lives here rather than only in App.jsx's own GlobalStyle, which doesn't
   * mount until after sign-in — without this, the sign-in screen's actual
   * <body> stayed transparent/default-white behind AuthGate's full-viewport
   * div, which is invisible normally but flashes white on mobile overscroll. */
  body { margin: 0; background: var(--bg); transition: background 200ms ease-out; }
  :root {
    --bg: #F7F7F4; --card: #FFFFFF; --card-soft: #FCFCFA;
    --line: #E9E9E3; --line-soft: #F0F0EB;
    --ink: #16181D; --ink2: #5A5F69; --ink3: #9AA0AA;
    --danger: #D9482B; --danger-bg: #FDF1EE; --danger-line: #F3CFC6;
    --lime: #C6F04D; --lime-deep: #7CB518;
    /* Item 4 — the per-workspace personal accent (applyAccent below)
     * overrides these six via inline root style, which wins over this rule
     * regardless of light/dark mode — these are just the fallback (today's
     * default "Fresh Lime") for a workspace nobody has personalized yet. */
    --lime-ink: #243305; --lime-mesh-1: #E9FBB7; --lime-mesh-2: #C6F04D; --lime-mesh-3: #8FD14F;
    --shadow-sm: 0 1px 2px rgba(22,24,29,0.04), 0 2px 8px rgba(22,24,29,0.04);
    --shadow-md: 0 1px 2px rgba(22,24,29,0.05), 0 8px 24px -8px rgba(22,24,29,0.09);
    --shadow-lg: 0 2px 4px rgba(22,24,29,0.05), 0 24px 48px -16px rgba(22,24,29,0.14);
    --scrollbar-thumb: #DEDED7;
    color-scheme: light;
  }
  :root[data-theme="dark"] {
    /* Warm charcoal rather than flat corporate gray — the lime accent is
     * meant to pop harder against this, not get muddier, which is most of
     * what makes a dark mode feel "playful" instead of just "inverted". */
    --bg: #14161A; --card: #1D2024; --card-soft: #191C20;
    --line: #2B2F36; --line-soft: #23262C;
    --ink: #F3F4EF; --ink2: #ABB0B9; --ink3: #767B84;
    --danger: #FF6B52; --danger-bg: #3A1E1A; --danger-line: #5C2E27;
    --lime: #D6F86C; --lime-deep: #9AD62A;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.25);
    --shadow-md: 0 1px 2px rgba(0,0,0,0.35), 0 8px 24px -8px rgba(0,0,0,0.45);
    --shadow-lg: 0 2px 4px rgba(0,0,0,0.4), 0 24px 48px -16px rgba(0,0,0,0.55);
    --scrollbar-thumb: #33373E;
    color-scheme: dark;
  }
`;

/* No saved choice yet → match the OS/browser preference rather than always
 * defaulting to light, since that's the one thing every "add dark mode"
 * request implicitly expects. */
export function getInitialTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/* ============================================================================
 * PER-WORKSPACE ACCENT (item 4) — a personal, device-local preference, same
 * storage shape as THEME_STORAGE_KEY above. Deliberately independent of
 * light/dark mode (like a company's own theme_json already is) rather than
 * needing its own dark-mode-adjusted variant — one flat set of colors that
 * a user picked, applied the same way regardless of color-mode.
 *
 * Reuses the exact {primary, ink, mesh:[3]} shape App.jsx's THEME_PRESETS
 * (and a company's own theme) already use, so the same picker component
 * works for both without a second color model to keep in sync.
 * ==========================================================================*/
const ACCENT_STORAGE_PREFIX = "pd.workspaceAccent.";

export function getStoredAccent(workspaceId, fallback) {
  if (!workspaceId) return fallback;
  try {
    const raw = localStorage.getItem(ACCENT_STORAGE_PREFIX + workspaceId);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed?.primary && parsed?.ink && Array.isArray(parsed?.mesh) && parsed.mesh.length === 3) return parsed;
  } catch { /* corrupt/old value — fall back rather than throw */ }
  return fallback;
}

export function storeAccent(workspaceId, theme) {
  if (!workspaceId) return;
  localStorage.setItem(ACCENT_STORAGE_PREFIX + workspaceId, JSON.stringify(theme));
}

/* Inline root style wins over the :root rule in THEME_CSS above regardless
 * of data-theme, which is what makes this independent of the dark/light
 * toggle without any special-casing here. */
export function applyAccent(theme) {
  const root = document.documentElement.style;
  root.setProperty("--lime", theme.mesh[1]);
  root.setProperty("--lime-deep", theme.primary);
  root.setProperty("--lime-ink", theme.ink);
  root.setProperty("--lime-mesh-1", theme.mesh[0]);
  root.setProperty("--lime-mesh-2", theme.mesh[1]);
  root.setProperty("--lime-mesh-3", theme.mesh[2]);
}
