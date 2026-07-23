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
