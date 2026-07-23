import React from "react";
import ReactDOM from "react-dom/client";
import AuthGate from "./auth/AuthGate.jsx";
import PuroductiveApp from "./App.jsx";
import { THEME_CSS, getInitialTheme, applyTheme } from "./lib/theme.js";

/* Rendered above AuthGate so dark mode works on the sign-in screen too, not
 * just once you're in — sign-in is the very first thing anyone sees, and it
 * used to be hardcoded light regardless of what the rest of the app did. */
applyTheme(getInitialTheme());

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <style>{THEME_CSS}</style>
    <AuthGate>{(session) => <PuroductiveApp session={session} />}</AuthGate>
  </React.StrictMode>
);
