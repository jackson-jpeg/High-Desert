import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Two ways to reach the audio element that have each broken playback.
 * Exported so src/lib/__tests__/eslint-rules.test.ts can prove they fire.
 */
export const AUDIO_ELEMENT_RULES = [
  {
    // The player is a detached `new Audio()`, never in the DOM, so this lookup
    // returns null in production: the sleep timer never paused (HD-001) and
    // bookmark markers never seeked (HD-012), while tests that put an <audio>
    // into the DOM passed.
    selector:
      "CallExpression[callee.property.name=/^(querySelector|querySelectorAll|getElementsByTagName)$/][arguments.0.value=/^audio\\b/]",
    message:
      "The player's audio element is not in the DOM. Use pauseEngine()/seekEngine()/getMediaElement() from @/audio/engine.",
  },
  {
    // An empty src resolves against the document URL: the browser fetches the
    // HTML page and tries to decode it as audio (HD-014).
    selector: "AssignmentExpression[left.property.name='src'][right.value='']",
    message: 'Never `src = ""` on a media element. Use el.removeAttribute("src"); el.load();',
  },
  {
    selector:
      "AssignmentExpression[left.property.name='src'][right.type='TemplateLiteral'][right.expressions.length=0][right.quasis.0.value.raw='']",
    message: 'Never `src = ``` on a media element. Use el.removeAttribute("src"); el.load();',
  },
  {
    selector:
      "CallExpression[callee.property.name='setAttribute'][arguments.0.value='src'][arguments.1.value='']",
    message: 'Never setAttribute("src", "") on a media element. Use el.removeAttribute("src"); el.load();',
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    // Tests assert the lookup returns null (as in production) and model
    // removeAttribute("src") on fakes; the ban is for code that ships.
    ignores: ["src/**/__tests__/**"],
    rules: {
      "no-restricted-syntax": ["error", ...AUDIO_ELEMENT_RULES],
    },
  },
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
    // Playwright's run output (npm run test:e2e).
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
  ]),
]);

export default eslintConfig;
