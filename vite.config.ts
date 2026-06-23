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
});
