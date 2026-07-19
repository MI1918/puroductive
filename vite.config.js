import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Back to the github.io/<repo>/ subpath until the puroductive.jhydro.in
  // DNS record is in place — see the custom-domain branch/commit for that.
  base: "/puroductive/",
  plugins: [react()],
});
