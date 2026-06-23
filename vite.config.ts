import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  // Relative base so the built bundle works from any path — standalone at "/"
  // and embedded under a subdirectory (e.g. jonas-jensen.com/apps/floor-planner/).
  // The dev server ignores a relative base and still serves at "/".
  base: "./",
  plugins: [react(), tailwindcss()],
  fmt: {},
  // Vitest config, bundled with vite-plus and run via `vp test`. Domain tests are
  // pure Node; the React component tests opt into jsdom per-file with a
  // `// @vitest-environment jsdom` directive.
  test: {
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    globals: false,
  },
});
