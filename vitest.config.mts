import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    // deploy.sh keeps the previous node_modules and build beside the live ones
    // for rollback; their packages' own test files are not ours to run.
    exclude: [
      ...configDefaults.exclude,
      "node_modules.*/**",
      ".next*/**",
      // Playwright specs run in a real browser against a running app
      // (npm run test:e2e). Their *.spec.ts names match vitest's default
      // include, and under jsdom they would fail on the first `test.describe`.
      "e2e/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
