import { configDefaults, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    // deploy.sh keeps the previous node_modules and build beside the live ones
    // for rollback; their packages' own test files are not ours to run.
    exclude: [...configDefaults.exclude, "node_modules.*/**", ".next*/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
