import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Root path: served from the puroductive.jhydro.in custom domain, not a
  // github.io/<repo>/ subpath.
  base: "/",
  plugins: [react()],
});
