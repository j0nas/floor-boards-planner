import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest gets its own config so it does not pass through the vite-plus
// `defineConfig` wrapper (which is incompatible with upstream Vitest 3.x).
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    environment: "node", // domain tests are pure; component tests opt into jsdom per-file
    setupFiles: ["./test/setup.ts"],
    globals: false,
  },
});
