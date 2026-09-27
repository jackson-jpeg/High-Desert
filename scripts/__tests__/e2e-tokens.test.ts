// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TOKEN_WORDS, rnd } from "../../e2e/tokens";
import { createModerator } from "../../services/live/lib/moderation/index.mjs";
import { parseBlocklist } from "../../services/live/lib/moderation/blocklist.mjs";

/**
 * The Live specs find their own calls by a random token in the text. If the
 * chat filter masks any part of one, the call goes out altered and the spec
 * fails for no reason of its own. So every token the helper can produce is
 * put through the real moderator, with the project's real blocklist, both as a
 * call and inside a name.
 */

const ROOT = path.resolve(__dirname, "../..");
const { entries } = parseBlocklist(readFileSync(path.join(ROOT, "data/chat-blocklist.txt"), "utf8"));
// The .mjs default parameter types its entries as never[]; the real list is what it takes.
const mod = createModerator((() => ({ entries, version: 1 })) as unknown as Parameters<typeof createModerator>[0]);

const every: string[] = [];
for (const a of TOKEN_WORDS) for (const b of TOKEN_WORDS) for (const c of TOKEN_WORDS) every.push(`${a}${b}${c}`);

describe("e2e tokens", () => {
  it("every token goes out unchanged in a call", () => {
    const altered = every.filter((t) => {
      const text = `Renamed caller checking in ${t}`;
      const r = mod.message(text);
      return !r.ok || r.text !== text;
    });
    expect(altered).toEqual([]);
  });

  it("every token makes a name that is accepted as written", () => {
    const refused = every.filter((t) => {
      const name = `Night Clerk in ${t.replace(/^./, (ch) => ch.toUpperCase())}`;
      const r = mod.name(name);
      return !r.ok || r.text !== name;
    });
    expect(refused).toEqual([]);
  });

  it("the helper draws three words from the list", () => {
    for (let i = 0; i < 50; i++) expect(every).toContain(rnd());
    expect(every).toHaveLength(TOKEN_WORDS.length ** 3);
  });
});
