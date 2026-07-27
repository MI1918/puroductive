import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Back to the github.io/<repo>/ subpath until the puroductive.jhydro.in
  // DNS record is in place — see the custom-domain branch/commit for that.
  base: "/puroductive/",
  plugins: [
    react(),
    /* item 9 — installable on Android/iOS/desktop home screens & app
     * launchers, and the app shell loads instantly (and works briefly
     * offline) instead of re-fetching JS/CSS on every open. generateSW mode
     * only precaches this build's own hashed assets — it never touches
     * Supabase's origin, so every read/write still goes straight to the
     * network, live, exactly as before. autoUpdate means a new deploy
     * replaces the cached shell on next load with no user-facing "update
     * available" prompt to manage. */
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Puroductive",
        short_name: "Puroductive",
        description: "Cross-company project & task supervisor.",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#16181D",
        theme_color: "#16181D",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
