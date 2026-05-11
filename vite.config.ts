import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { execSync } from "node:child_process";

// Reads "v1.0.0" on an exact tag, "v1.0.0-3-g7fabc12" three commits past a tag,
// or just the short SHA if no tag is reachable. Appends "-dirty" when the
// working tree has uncommitted changes at build time.
const APP_VERSION = (() => {
  try {
    return execSync("git describe --tags --always --dirty", { encoding: "utf-8" }).trim();
  } catch {
    return "dev";
  }
})();

export default defineConfig({
  plugins: [
    // File-based routing — generates src/routeTree.gen.ts from src/routes/**.
    TanStackRouterVite({ autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    port: 3000,
  },
});
