// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";

/**
 * The no-restricted-syntax bans in eslint.config.mjs, run through ESLint itself
 * against the real config. A rule that silently stops matching (a selector
 * typo, a config block that no longer applies to src/) is indistinguishable
 * from a codebase that obeys it — so assert it still fires.
 */

const ROOT = path.resolve(__dirname, "../../..");
const eslint = new ESLint({ cwd: ROOT });

async function messages(code: string, file = "src/lint-probe.ts"): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(ROOT, file),
  });
  return result.messages
    .filter((m) => m.ruleId === "no-restricted-syntax")
    .map((m) => `${m.line}: ${m.message}`);
}

describe("audio element lint bans", () => {
  it('flags document.querySelector("audio") — the player is not in the DOM (HD-001, HD-012)', async () => {
    const found = await messages(
      'export const a = document.querySelector("audio");\n' +
        'export const b = document.querySelectorAll("audio.preview");\n',
    );
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/^1: The player's audio element is not in the DOM/);
    expect(found[1]).toMatch(/^2: /);
  }, 30_000);

  it('flags every spelling of an empty src (HD-014)', async () => {
    const found = await messages(
      "export function f(el: HTMLAudioElement) {\n" +
        '  el.src = "";\n' +
        "  el.src = ``;\n" +
        '  el.setAttribute("src", "");\n' +
        "}\n",
    );
    expect(found.map((m) => m.split(":")[0])).toEqual(["2", "3", "4"]);
    for (const m of found) expect(m).toMatch(/removeAttribute\("src"\)/);
  }, 30_000);

  it("leaves the safe forms alone", async () => {
    const found = await messages(
      "export function f(el: HTMLAudioElement) {\n" +
        '  el.removeAttribute("src");\n' +
        "  el.load();\n" +
        '  el.src = "https://archive.org/download/x/y.mp3";\n' +
        '  return document.querySelector("audiobook-list");\n' +
        "}\n",
    );
    expect(found).toEqual([]);
  }, 30_000);
});

describe("hd:* event name ban (HD-019)", () => {
  it("flags an hd:* name spelled outside src/lib/events.ts, in every form", async () => {
    const found = await messages(
      'window.dispatchEvent(new CustomEvent("hd:sort", { detail: "date" }));\n' +
        'window.addEventListener("hd:shuffle", () => {});\n' +
        "export const name = `hd:${String(1)}`;\n",
    );
    expect(found.map((m) => m.split(":")[0])).toEqual(["1", "2", "3"]);
    for (const m of found) expect(m).toMatch(/src\/lib\/events\.ts/);
  }, 30_000);

  it("allows them in src/lib/events.ts, which is where they are declared", async () => {
    const found = await messages(
      'export const SW = "hd:offline-fallback";\n' +
        "export const name = (t: string) => `hd:${t}`;\n",
      "src/lib/events.ts",
    );
    expect(found).toEqual([]);
  }, 30_000);

  it("still applies the audio bans in src/lib/events.ts", async () => {
    const found = await messages('export const a = document.querySelector("audio");\n', "src/lib/events.ts");
    expect(found).toHaveLength(1);
  }, 30_000);

  it("leaves look-alikes alone", async () => {
    const found = await messages(
      'export const a = "text-hd-micro";\n' +
        'export const b = "hd-visited";\n' +
        'export const c = "see hd:sort";\n',
    );
    expect(found).toEqual([]);
  }, 30_000);
});

describe("e2e specs take test from e2e/fixtures.ts", () => {
  async function restrictedImports(code: string, file: string): Promise<string[]> {
    const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
    return result.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
  }

  it("flags a spec importing test from @playwright/test — it would write plays to the server", async () => {
    const found = await restrictedImports('import { test } from "@playwright/test";\ntest("x", () => {});\n', "e2e/probe.spec.ts");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/fixtures/);
  }, 30_000);

  it("allows the fixture itself, and type-only imports elsewhere", async () => {
    expect(await restrictedImports('import { test } from "@playwright/test";\nexport { test };\n', "e2e/fixtures.ts")).toEqual([]);
    expect(await restrictedImports('import type { Page } from "@playwright/test";\nexport type P = Page;\n', "e2e/probe.spec.ts")).toEqual([]);
  }, 30_000);
});

describe("text opacity floor (HD-023)", () => {
  async function floorHits(code: string, file = "src/lint-probe.tsx"): Promise<string[]> {
    const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
    const fatal = result.messages.filter((m) => m.fatal);
    expect(fatal, "the probe must parse").toEqual([]);
    return result.messages
      .filter((m) => m.ruleId === "hd/text-opacity-floor")
      .map((m) => `${m.line}: ${m.message.split("`")[1]}`);
  }

  it("flags dim text in className and cn()/clsx() arguments, in every spelling", async () => {
    const found = await floorHits(
      'import { cn } from "@/lib/utils/cn";\n' +
        'import clsx from "clsx";\n' +
        "export function A({ on }: { on: boolean }) {\n" +
        "  return (\n" +
        "    <div>\n" +
        '      <span className="text-hd-10 text-bevel-dark/60">a</span>\n' +
        '      <span className={cn("text-hd-10", on && "text-desert-amber/30")}>b</span>\n' +
        '      <span className={cn(on ? "opacity-50" : "opacity-100")}>c</span>\n' +
        "      <span className={`px-1 hover:text-white/70 ${on ? \"x\" : \"y\"}`}>d</span>\n" +
        '      <span className={clsx({ "opacity-[0.4]": on }, ["text-red-400/[0.6]"])}>e</span>\n' +
        "    </div>\n" +
        "  );\n" +
        "}\n",
    );
    expect(found).toEqual([
      "6: text-bevel-dark/60",
      "7: text-desert-amber/30",
      "8: opacity-50",
      "9: hover:text-white/70",
      "10: opacity-[0.4]",
      "10: text-red-400/[0.6]",
    ]);
  }, 30_000);

  it("the floor is /85: 85 passes, 84 does not", async () => {
    const found = await floorHits(
      "export const A = () => (\n" +
        "  <>\n" +
        '    <span className="text-bevel-dark/85 opacity-85">ok</span>\n' +
        '    <span className="text-bevel-dark/84">dim</span>\n' +
        '    <span className="opacity-80">dim</span>\n' +
        "  </>\n" +
        ");\n",
    );
    expect(found).toEqual(["4: text-bevel-dark/84", "5: opacity-80"]);
  }, 30_000);

  it("leaves alone what is not dim text", async () => {
    const found = await floorHits(
      'import { cn } from "@/lib/utils/cn";\n' +
        "export const A = ({ on }: { on: boolean }) => (\n" +
        "  <>\n" +
        // Font size with a line height, not a colour.
        '    <span className="text-sm/6 text-hd-12/5">size</span>\n' +
        // Backgrounds and borders are not text.
        '    <span className="bg-black/50 border-bevel-dark/20 ring-white/10">bg</span>\n' +
        // Invisible is not dim: a reveal-on-hover control.
        '    <span className="opacity-0 group-hover:opacity-100 md:text-red-400/0">hidden</span>\n' +
        // WCAG 1.4.3 exempts inactive components.
        '    <button className={cn("disabled:opacity-40", on && "aria-disabled:opacity-50")}>x</button>\n' +
        "  </>\n" +
        ");\n" +
        // Not a class list: not className, not cn().
        'export const label = "text-bevel-dark/50";\n',
    );
    expect(found).toEqual([]);
  }, 30_000);

  it("is disabled line by line for decorative elements, and only that line", async () => {
    const found = await floorHits(
      "export const A = () => (\n" +
        "  <>\n" +
        "    {/* A texture, not text. */}\n" +
        "    {/* eslint-disable-next-line hd/text-opacity-floor */}\n" +
        '    <div className="opacity-[0.04]" aria-hidden="true" />\n' +
        '    <div className="opacity-40">text</div>\n' +
        "  </>\n" +
        ");\n",
    );
    expect(found).toEqual(["6: opacity-40"]);
  }, 30_000);
});
