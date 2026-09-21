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

/**
 * `hd:*` window event names may be spelled only in src/lib/events.ts, which
 * types them (HD-019). A raw `new CustomEvent("hd:sort")` elsewhere is
 * untyped, invisible to the listener-per-route test, and exactly how a library
 * intent came to be fired on pages where nothing listened (HD-013).
 */
export const HD_EVENT_NAME_RULES = [
  {
    selector: "Literal[value=/^hd:/]",
    message: 'hd:* event names live in src/lib/events.ts. Use emit("key", detail) / useHdEvent("key", handler) from @/lib/events.',
  },
  {
    selector: "TemplateElement[value.raw=/^hd:/]",
    message: 'hd:* event names live in src/lib/events.ts. Use emit("key", detail) / useHdEvent("key", handler) from @/lib/events.',
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
      "no-restricted-syntax": ["error", ...AUDIO_ELEMENT_RULES, ...HD_EVENT_NAME_RULES],
    },
  },
  {
    // The one file allowed to spell an hd:* name. A later block replaces the
    // rule's options wholesale, so the audio bans are restated here.
    files: ["src/lib/events.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...AUDIO_ELEMENT_RULES /* not HD_EVENT_NAME_RULES */],
    },
  },
  {
    // Specs take `test` from e2e/fixtures.ts, which answers every stats write
    // in the page and blocks the service worker. Imported straight from
    // Playwright, a spec that starts a show writes a play to whatever server
    // it is pointed at — production included (playwright.config.ts).
    files: ["e2e/**/*.ts"],
    ignores: ["e2e/fixtures.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@playwright/test",
          message: "Import test/expect from ./fixtures — it keeps specs from writing to the server.",
          allowTypeImports: true,
        }],
      }],
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
