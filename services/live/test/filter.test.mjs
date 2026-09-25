// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createModerator } from "../lib/moderation/index.mjs";
import { parseBlocklist, watchedBlocklist } from "../lib/moderation/blocklist.mjs";
import { createProfanityFilter } from "../lib/moderation/profanity.mjs";
import { normalizeText, codePointLength } from "../lib/moderation/normalize.mjs";

/**
 * The word filter, against the real project blocklist (data/chat-blocklist.txt)
 * and the real library dataset.
 *
 * FIXTURES ARE ENCODED. Nothing offensive is spelled in this file or in
 * fixtures/filter.json: the words are base64, decoded here, and every evasion
 * variant is *derived* from them below — so a new word in the fixture is
 * automatically tried in every disguise.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..");
const BLOCKLIST = path.join(ROOT, "data/chat-blocklist.txt");
const fixture = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/filter.json"), "utf8"));
const decode = (b64) => Buffer.from(b64, "base64").toString("utf8");

const { entries, errors } = parseBlocklist(readFileSync(BLOCKLIST, "utf8"));
const mod = createModerator(() => ({ entries, version: 1 }));

// ---- evasion variants -------------------------------------------------------

const LEET = { a: "4", e: "3", i: "1", o: "0", s: "5" };
const LEET_SYM = { a: "@", s: "$", i: "!" };
const CYRILLIC = { a: "\u0430", e: "\u0435", o: "\u043e", c: "\u0441", p: "\u0440", x: "\u0445", i: "\u0456", y: "\u0443" };
const GREEK = { o: "\u03bf", i: "\u03b9", k: "\u03ba", n: "\u03b7", t: "\u03c4" };
const sub = (w, map) => [...w].map((c) => map[c] ?? c).join("");
const has = (w, map) => [...w].some((c) => map[c]);

/** Every disguise the owner asked for. `null` = not applicable to this word. */
const VARIANTS = {
  plain: (w) => w,
  upper: (w) => w.toUpperCase(),
  mixedCase: (w) => [...w].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join(""),
  leetDigits: (w) => (has(w, LEET) ? sub(w, LEET) : null),
  leetSymbols: (w) => (has(w, LEET_SYM) ? sub(w, LEET_SYM) : null),
  spaced: (w) => [...w].join(" "),
  dotted: (w) => [...w].join("."),
  dashed: (w) => [...w].join("-"),
  underscored: (w) => [...w].join("_"),
  splitMidWord: (w) => (w.length >= 4 ? `${w.slice(0, 2)}.${w.slice(2)}` : null),
  repeatedLetters: (w) => [...w].map((c) => c + c + c).join(""),
  stretchedVowel: (w) => w.replace(/[aeiou]/, (v) => v.repeat(5)),
  cyrillic: (w) => (has(w, CYRILLIC) ? sub(w, CYRILLIC) : null),
  greek: (w) => (has(w, GREEK) ? sub(w, GREEK) : null),
  fullwidth: (w) => [...w].map((c) => (c === " " ? c : String.fromCharCode(c.charCodeAt(0) + 0xfee0))).join(""),
  zeroWidthSpace: (w) => [...w].join("\u200b"),
  zeroWidthJoiner: (w) => [...w].join("\u200d"),
  softHyphen: (w) => [...w].join("\u00ad"),
  accented: (w) => w.replace(/[aeiou]/, (v) => v + "\u0301"),
  leetAndSpaced: (w) => (has(w, LEET) ? [...sub(w, LEET)].join(" ") : null),
  inSentence: (w) => `ok so ${w} and then`,
};

function variantsOf(word) {
  const out = [];
  for (const [name, f] of Object.entries(VARIANTS)) {
    // Spacing tricks apply to single words; a phrase's own spaces are its own.
    if (word.includes(" ") && /spaced|dotted|dashed|underscored|repeated|zeroWidth|softHyphen|splitMidWord/i.test(name)) continue;
    const v = f(word);
    if (v !== null && v !== undefined) out.push([name, v]);
  }
  return out;
}

describe("the blocklist file", () => {
  it("parses without errors", () => {
    expect(errors).toEqual([]);
    expect(entries.length).toBeGreaterThan(20);
  });

  it("parses kinds, wildcards, comments and base64", () => {
    const { entries: e, errors: err } = parseBlocklist(
      ["# comment", "", "plain term  # trailing comment", "*suffixed", "prefixed*", "*both*", "mask: soft", "allow: fine",
        `b64:${Buffer.from("hidden term").toString("base64")}`, `mask: b64:${Buffer.from("hush").toString("base64")}`, "b64:"].join("\n"),
    );
    expect(e.map(({ kind, term, prefix, suffix }) => [kind, term, prefix, suffix])).toEqual([
      ["block", "plain term", false, false],
      ["block", "suffixed", true, false],
      ["block", "prefixed", false, true],
      ["block", "both", true, true],
      ["mask", "soft", false, false],
      ["allow", "fine", false, false],
      ["block", "hidden term", false, false],
      ["mask", "hush", false, false],
    ]);
    expect(err).toHaveLength(1);
  });
});

describe("blocked outright: slurs and sexual terms", () => {
  for (const b64 of fixture.block) {
    const word = decode(b64);
    it(`word #${fixture.block.indexOf(b64)} in every disguise`, () => {
      const passed = variantsOf(word)
        .filter(([, v]) => mod.message(v).ok)
        .map(([name]) => name);
      expect(passed, `variants that got through for fixture block[${fixture.block.indexOf(b64)}]`).toEqual([]);
    });
  }
  it("in context", () => {
    for (const s of fixture.sentencesBlock) expect(mod.message(decode(s))).toEqual({ ok: false, reason: "blocked" });
  });
});

describe("blocked outright: threats and hate phrases (project blocklist)", () => {
  for (const b64 of fixture.threats) {
    const phrase = decode(b64);
    it(`threat #${fixture.threats.indexOf(b64)} in every disguise`, () => {
      const passed = variantsOf(phrase)
        .filter(([, v]) => mod.message(v).ok)
        .map(([name]) => name);
      expect(passed).toEqual([]);
    });
  }
  it("a threat split into single letters is still seen", () => {
    const phrase = decode(fixture.threats[0]);
    const [first, ...rest] = phrase.split(" ");
    expect(mod.message(`${[...first].join(" ")} ${rest.join(" ")}`).ok).toBe(false);
  });
});

describe("numeric hate codes match digit for digit", () => {
  // The matcher's repeat-collapse folded "1488" to "148" and refused every
  // "148" — a route, an episode number, a load-test caller. Numbers are
  // matched as numbers: separators allowed, a longer number is not a match.
  it.each(["1488", "14 88", "1-4-8-8", "calling 1488 tonight", "1 4 8 8"])("refuses %j", (text) => {
    expect(mod.message(text)).toMatchObject({ ok: false, reason: "blocked" });
  });
  it.each(["148", "route 148", "14888", "21488", "caller 148 on line 88", "14 8"])("passes %j untouched", (text) => {
    expect(mod.message(text)).toEqual({ ok: true, text });
  });
});

describe("masked: mild profanity", () => {
  for (const b64 of fixture.mask) {
    const word = decode(b64);
    it(`word #${fixture.mask.indexOf(b64)} is masked, not refused, in every disguise`, () => {
      for (const [name, v] of variantsOf(word)) {
        const r = mod.message(v);
        expect(r.ok, name).toBe(true);
        expect(r.text, name).toContain("*");
        expect(r.text.replace(/[*\s]/g, ""), `${name}: every letter of the word is hidden`).not.toMatch(
          new RegExp(`${word.slice(0, 3)}`, "i"),
        );
      }
    });
  }
  it("replaces exactly the word, leaving the sentence", () => {
    for (const { in: input, out } of fixture.sentencesMask) {
      expect(mod.message(decode(input))).toEqual({ ok: true, text: decode(out) });
    }
  });
});

describe("false positives: innocent words stay untouched", () => {
  const INNOCENT = [
    "Scunthorpe", "assassin", "classic", "Pahrump", "Dixie Valley", "Niger", "Nigeria", "cocktail hour",
    "Sussex and Essex", "analysis", "grape", "therapist", "Hancock", "Titanic", "bass fishing", "Arsenal",
    "cumin", "pussycat", "Uranus", "skill you", "spice", "Moab", "Area 51", "Mr. Bell", "document",
    "Cockburn", "shiitake", "Fukushima", "sheeeeesh", "noooooo way", "cooool", "Coast to Coast AM",
    "the Mothman of Point Pleasant", "Philip K. Dick", "raccoon", "tycoon", "specimen", "a b c d",
  ];
  for (const s of INNOCENT) {
    it(JSON.stringify(s), () => {
      expect(mod.message(s)).toEqual({ ok: true, text: s });
    });
  }

  it("every title, guest name and summary in the catalog passes untouched", () => {
    const lib = JSON.parse(readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8"));
    const hurt = [];
    for (const e of lib) {
      for (const f of ["title", "guestName", "aiSummary"]) {
        const v = typeof e[f] === "string" ? normalizeText([...normalizeText(e[f])].slice(0, 280).join("")) : "";
        if (!v) continue;
        const r = mod.message(v);
        if (!r.ok || r.text !== v) hurt.push(`${f}: ${r.ok ? "masked" : r.reason}: ${e.fileHash}`);
      }
    }
    expect(hurt).toEqual([]);
  });
});

describe("normalisation", () => {
  it("NFKC, format characters out, whitespace collapsed, trimmed", () => {
    expect(normalizeText("  \uff28ello\u200b\u200d  \n\t world\u202e ")).toBe("Hello world");
    expect(normalizeText("a\u0000b")).toBe("a b");
    expect(normalizeText("e\u0301\u0301\u0301\u0301")).toBe("\u00e9\u0301\u0301"); // Zalgo: two marks kept
  });

  it("280 characters counted in code points, after normalisation", () => {
    const emoji = "\u{1F6F8}"; // two UTF-16 units, one character
    expect(mod.message(emoji.repeat(280))).toEqual({ ok: true, text: emoji.repeat(280) });
    expect(mod.message(emoji.repeat(281))).toEqual({ ok: false, reason: "too-long" });
    expect(mod.message(`${"a".repeat(280)}   `).ok).toBe(true);
    expect(mod.message("a".repeat(281)).reason).toBe("too-long");
    expect(codePointLength("a\u{1F6F8}")).toBe(2);
  });

  it("an empty or invisible message is refused", () => {
    expect(mod.message("   \u200b ").reason).toBe("empty");
  });
});

describe("the filter is built from the blocklist it is given", () => {
  it("a new block term refuses; mask masks; allow un-flags", () => {
    const f = createProfanityFilter([
      { kind: "block", term: "zorblax", prefix: false, suffix: false },
      { kind: "mask", term: "blarg", prefix: false, suffix: false },
    ]);
    expect(f.check("the zorblax came").blocked).toBe(true);
    expect(f.check("the z0rbl4x came").blocked).toBe(true);
    expect(f.check("the zorblaxes came").blocked).toBe(false); // whole word by default
    expect(f.check("oh blarg it").masked).toBe("oh ***** it");
    const g = createProfanityFilter([{ kind: "block", term: "zorblax", prefix: true, suffix: true }]);
    expect(g.check("megazorblaxes").blocked).toBe(true);
  });

  it("reloads when the file changes", async () => {
    const { mkdtemp, writeFile, utimes } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "bl-"));
    const file = path.join(dir, "bl.txt");
    await writeFile(file, "zorblax\n");
    let t = 0;
    const w = watchedBlocklist(file, { checkEveryMs: 1000, now: () => t });
    const m = createModerator(() => w.get());
    expect(m.message("a zorblax").ok).toBe(false);
    expect(m.message("a quuxor").ok).toBe(true);
    await writeFile(file, "quuxor\n");
    await utimes(file, new Date(), new Date(Date.now() + 5000));
    t = 2000;
    expect(m.message("a quuxor").ok).toBe(false);
    expect(m.message("a zorblax").ok).toBe(true);
  });
});
