import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { MUTATIONS } from "../../../scripts/mutate-check.mjs";

/**
 * Every store has a test, and a mutation that proves the test sees it.
 *
 * CLAUDE.md said "all nine have tests in src/stores/__tests__/ and a mutation
 * each", and for player-store — the one with the queue arithmetic — neither
 * was true (HD-042). Nothing checked the sentence, so it stayed true on paper.
 * This is the check: the list of stores is read from the directory, the list
 * of mutations from scripts/mutate-check.mjs itself (imported, not parsed, so
 * a reformatted entry cannot hide from it), and each store must appear in
 * both.
 *
 * The convention verified: `src/stores/<name>.ts` is tested by
 * `src/stores/__tests__/<name>.test.ts`, and at least one mutation has
 * `file: "src/stores/<name>.ts"`. A mutation whose test lives elsewhere still
 * counts — what matters is that some test is proven to observe the store.
 */

const STORES_DIR = path.resolve(import.meta.dirname, "..");
const TESTS_DIR = path.join(STORES_DIR, "__tests__");

type Mutation = { id: string; file: string; test: string };

const stores = readdirSync(STORES_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
const tests = new Set(readdirSync(TESTS_DIR));
const mutated = new Set((MUTATIONS as Mutation[]).map((m) => m.file));

describe("store coverage", () => {
  it("finds the stores and the mutation list (an empty glob would pass everything below)", () => {
    expect(stores.length).toBeGreaterThanOrEqual(9);
    expect(stores).toContain("player-store.ts");
    expect((MUTATIONS as Mutation[]).length).toBeGreaterThan(0);
  });

  it.each(stores)("%s has a test file in src/stores/__tests__/", (store) => {
    expect(tests.has(store.replace(/\.ts$/, ".test.ts"))).toBe(true);
  });

  it.each(stores)("%s has at least one mutation in scripts/mutate-check.mjs", (store) => {
    expect(mutated.has(`src/stores/${store}`)).toBe(true);
  });
});
