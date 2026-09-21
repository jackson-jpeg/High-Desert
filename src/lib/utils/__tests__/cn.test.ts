import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cn } from "../cn";

/**
 * `cn()` against the real tailwind-merge. Plain `twMerge` read `text-hd-micro`
 * as a text colour, so a size followed by a colour lost the size — 46 call
 * sites rendered at the inherited body size.
 */

const GLOBALS_CSS = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");

/** Every `--text-hd-<name>:` declared in globals.css (not the `--line-height` companions). */
const sizeTokens = [...GLOBALS_CSS.matchAll(/--text-(hd-[a-z0-9]+):/g)].map((m) => `text-${m[1]}`);

describe("cn — project font sizes", () => {
  it("parses the type scale out of globals.css", () => {
    // Guard against the regex silently matching nothing, which would make the
    // "every token" test below vacuous.
    expect(sizeTokens).toContain("text-hd-micro");
    expect(sizeTokens).toContain("text-hd-hero");
    expect(sizeTokens).toContain("text-hd-10");
    expect(sizeTokens.length).toBeGreaterThanOrEqual(26);
  });

  it("keeps a size and a colour, size first", () => {
    expect(cn("text-hd-micro text-bevel-dark/85")).toBe("text-hd-micro text-bevel-dark/85");
  });

  it("keeps a size and a colour, colour first", () => {
    expect(cn("text-desert-amber", "text-hd-caption")).toBe("text-desert-amber text-hd-caption");
  });

  it("keeps a responsive size alongside a colour", () => {
    expect(cn("text-hd-12 md:text-hd-10", "text-desktop-gray")).toBe(
      "text-hd-12 md:text-hd-10 text-desktop-gray",
    );
  });

  it("two sizes: the later one wins", () => {
    expect(cn("text-hd-micro", "text-hd-title")).toBe("text-hd-title");
    expect(cn("text-hd-10 text-desert-amber", "text-hd-h2")).toBe("text-desert-amber text-hd-h2");
  });

  it("two colours: the later one wins", () => {
    expect(cn("text-hd-body text-bevel-dark", "text-desert-amber")).toBe("text-hd-body text-desert-amber");
  });

  it("recognises every size token in globals.css as a font size", () => {
    for (const size of sizeTokens) {
      // A size is only "recognised" if it survives a following colour AND is
      // replaced by a following size — the two halves of being in the group.
      expect(cn(size, "text-bevel-dark"), size).toBe(`${size} text-bevel-dark`);
      expect(cn(size, "text-sm"), size).toBe("text-sm");
    }
  });

  it("no colour token is named hd-*, so the size group cannot swallow one", () => {
    expect([...GLOBALS_CSS.matchAll(/--color-(hd-[a-z0-9-]+)/g)].map((m) => m[1])).toEqual([]);
  });
});
