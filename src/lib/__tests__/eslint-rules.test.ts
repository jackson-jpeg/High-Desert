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

async function messages(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(ROOT, "src/lint-probe.ts"),
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
