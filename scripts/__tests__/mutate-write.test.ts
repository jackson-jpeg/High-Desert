// @vitest-environment node
/**
 * mutate-check.mjs writes its targets whole or not at all (`writeWhole`).
 *
 * On 2026-11-18 a run was killed while it put the files back, and
 * `src/lib/shows/next.ts` was left at 0 bytes: `writeFile` truncates first and
 * writes after, and a SIGKILL landed in between. Here a real child process is
 * parked at the moment between "the new text is on disk" and "the target is
 * replaced", then SIGKILLed. The target must be whole (the old text). The
 * control parks a truncate-then-write writer at its own in-between moment and
 * finds the target empty, so this harness can see the failure it guards.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeWhole } from "../mutate-check.mjs";

const SCRIPT = pathToFileURL(path.resolve(import.meta.dirname, "../mutate-check.mjs")).href;
const ORIGINAL = "export const original = true;\n".repeat(200);
const MUTATED = "export const original = false;\n".repeat(200);

/** Parks after its first half (prints "ready", then blocks forever). */
const CHILD = `
import { writeSync, openSync, closeSync } from "node:fs";
const target = process.env.HD_TARGET;
const text = process.env.HD_TEXT;
const park = () => {
  writeSync(1, "ready\\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
if (process.env.HD_WRITER === "whole") {
  const { writeWhole } = await import(process.env.HD_SCRIPT);
  writeWhole(target, text, { afterTemp: park });
} else {
  // What writeFile does: open with O_TRUNC, then write.
  const fd = openSync(target, "w");
  park();
  writeSync(fd, text);
  closeSync(fd);
}
`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "mutate-write-"));
  dirs.push(dir);
  const target = path.join(dir, "next.ts");
  writeFileSync(target, ORIGINAL, "utf8");
  return { dir, target };
}

/** Start a writer, SIGKILL it at its in-between moment, resolve once it is gone. */
function killMidWrite(writer: "whole" | "truncate", target: string): Promise<{ parked: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD], {
      env: { ...process.env, HD_TARGET: target, HD_TEXT: MUTATED, HD_WRITER: writer, HD_SCRIPT: SCRIPT },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let parked = false;
    let err = "";
    child.stdout.on("data", (d) => {
      if (!parked && String(d).includes("ready")) {
        parked = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", () => (parked ? resolve({ parked }) : reject(new Error(`child never parked: ${err}`))));
  });
}

describe("writeWhole: a kill never leaves a target empty", () => {
  it("killed after the temp file is written and before the rename, the target is still whole", async () => {
    const { dir, target } = fixture();
    await killMidWrite("whole", target);
    expect(readFileSync(target, "utf8")).toBe(ORIGINAL);
    // The leftover is the one the header names, beside the target.
    const left = readdirSync(dir).filter((f) => f !== "next.ts");
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/^\.next\.ts\.mutate-\d+\.tmp$/);
    expect(readFileSync(path.join(dir, left[0]), "utf8")).toBe(MUTATED);
  }, 30_000);

  it("control: a truncate-then-write writer killed at its own in-between moment leaves the target empty", async () => {
    const { target } = fixture();
    await killMidWrite("truncate", target);
    expect(readFileSync(target, "utf8")).toBe("");
  }, 30_000);

  it("uninterrupted, it replaces the text, keeps the mode and leaves no temp file", () => {
    const { dir, target } = fixture();
    chmodSync(target, 0o755);
    writeWhole(target, MUTATED);
    expect(readFileSync(target, "utf8")).toBe(MUTATED);
    expect(statSync(target).mode & 0o777).toBe(0o755);
    expect(readdirSync(dir)).toEqual(["next.ts"]);
  });
});
