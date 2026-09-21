import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // deploy.sh's rollback copies and staging build (scripts/deploy.sh).
    ".next.prev/**",
    ".next.failed/**",
    ".next-staging/**",
    "node_modules.*/**",
  ]),
]);

export default eslintConfig;
