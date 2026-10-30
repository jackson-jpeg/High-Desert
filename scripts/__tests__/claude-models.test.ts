// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { clearGitEnv } from "@/test-support/git-env";

/**
 * The model policy (Jackson, 2026-10-30), held: every Claude model id lives in
 * scripts/claude_models.py, every one there is in the API's own model list (the
 * committed snapshot of GET /v1/models beside it), and each is the newest of
 * its tier in that list, so refreshing the snapshot names the next upgrade.
 * Then the one caller, scripts/categorize-library.py, is held to that config
 * and to Sonnet 5.5's request rules. Nothing here calls the API.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const CONFIG = "scripts/claude_models.py";
const SNAPSHOT = "scripts/anthropic-models.json";

/**
 * Not scanned: docs and handoffs (they say which model ran at the time and stay
 * as they were), this file (it names ids as samples for the pattern), and the
 * mutation list (it names ids as the defects its entries stage).
 */
const NOT_SOURCE = [/\.md$/, /^docs\//];
const SKIP = new Set([CONFIG, SNAPSHOT, "scripts/__tests__/claude-models.test.ts", "scripts/mutate-check.mjs"]);

/**
 * A Claude model id: claude- and then a model family, or an old-style version
 * number (1 to 9). Not claude-code, `claude -p`, or Claude Code's /tmp/claude-0.
 */
const MODEL_ID = /\bclaude-(?:(?:haiku|sonnet|opus|fable|mythos|instant)\b|[1-9](?:\.\d)?(?:-|\b))[\w.@-]*/g;

interface SnapshotModel { id: string; created_at: string; line?: string }
const snapshot = JSON.parse(readFileSync(path.join(ROOT, SNAPSHOT), "utf8")) as { fetched_at: string; data: SnapshotModel[] };

const tierOf = (id: string): string | undefined =>
  snapshot.data.find((m) => m.id === id)?.line ?? /^claude-([a-z]+)-/.exec(id)?.[1];

function newestOf(tier: string): string | undefined {
  const of = snapshot.data.filter((m) => tierOf(m.id) === tier);
  return of.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]?.id;
}

function tracked(): string[] {
  const env: Record<string, string | undefined> = { ...process.env };
  clearGitEnv(env);
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, env: env as NodeJS.ProcessEnv })
    .toString()
    .split("\0")
    .filter(Boolean);
}

/** Every model id in tracked source outside the config and the snapshot, as "file:line: id". */
function strays(files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (SKIP.has(f) || NOT_SOURCE.some((r) => r.test(f))) continue;
    let buf: Buffer;
    try {
      buf = readFileSync(path.join(ROOT, f));
    } catch {
      continue; // deleted in the working tree
    }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    buf.toString("utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(MODEL_ID)) out.push(`${f}:${i + 1}: ${m[0]}`);
    });
  }
  return out;
}

/**
 * Runs Python against the real modules (the config, and categorize-library.py
 * loaded as a module, so main() never runs) and returns what it prints as JSON.
 * No key and no model override reach it.
 */
function python(code: string): Record<string, unknown> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.HD_CATEGORIZE_MODEL;
  const prelude = [
    "import importlib.util, json, sys",
    "sys.path.insert(0, 'scripts')",
    "import claude_models",
    "spec = importlib.util.spec_from_file_location('categorize', 'scripts/categorize-library.py')",
    "cat = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(cat)",
  ].join("\n");
  // -B: no __pycache__ left in the tree (deploy.sh refuses a dirty one).
  const r = spawnSync("python3", ["-I", "-B", "-c", `${prelude}\n${code}`], { cwd: ROOT, env: env as NodeJS.ProcessEnv, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`python3 exited ${r.status}: ${r.stderr || r.error}`);
  return JSON.parse(r.stdout);
}

const config = python("print(json.dumps({k: getattr(claude_models, k) for k in ('HAIKU_MODEL', 'SONNET_MODEL', 'OPUS_MODEL')}))") as Record<
  "HAIKU_MODEL" | "SONNET_MODEL" | "OPUS_MODEL",
  string
>;

describe("Claude model ids: one config, on the API's list, newest of each tier", () => {
  const files = tracked();

  it("the scan sees the repo (control: the config and its one caller are tracked)", () => {
    expect(files).toContain(CONFIG);
    expect(files).toContain("scripts/categorize-library.py");
    expect(files.length).toBeGreaterThan(500);
  });

  it("the pattern finds model ids and nothing that only starts with claude-", () => {
    const found = (s: string) => [...s.matchAll(MODEL_ID)].map((m) => m[0]);
    expect(found('MODEL = "claude-haiku-4-5-20251001"')).toEqual(["claude-haiku-4-5-20251001"]);
    expect(found("anthropic.claude-sonnet-4-6 and claude-3-5-sonnet-latest, claude-opus-4-1@20250805")).toEqual([
      "claude-sonnet-4-6",
      "claude-3-5-sonnet-latest",
      "claude-opus-4-1@20250805",
    ]);
    expect(found("claude-2.1, claude-instant-1.2")).toEqual(["claude-2.1", "claude-instant-1.2"]);
    expect(found("claude -p, claude-code, /tmp/claude-0/x, claude-cli-nodejs, claude-high-desert-1, claude-1a2b")).toEqual([]);
    expect(found(readFileSync(path.join(ROOT, CONFIG), "utf8"))).toHaveLength(3);
  });

  it("no model id in tracked source outside scripts/claude_models.py", () => {
    expect(strays(files)).toEqual([]);
  });

  it("the snapshot is the API's list, dated", () => {
    expect(snapshot.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshot.data.length).toBeGreaterThan(0);
    for (const m of snapshot.data) expect(Date.parse(m.created_at), m.id).not.toBeNaN();
  });

  it("every configured id is in the snapshot", () => {
    const listed = new Set(snapshot.data.map((m) => m.id));
    for (const [name, id] of Object.entries(config)) expect(listed.has(id), `${name} = ${id} is not in ${SNAPSHOT}`).toBe(true);
  });

  it("each tier's id is the newest of that tier in the snapshot", () => {
    for (const [name, tier] of [["HAIKU_MODEL", "haiku"], ["SONNET_MODEL", "sonnet"], ["OPUS_MODEL", "opus"]] as const) {
      const id = config[name];
      expect(tierOf(id), `${name} = ${id} is not a ${tier} model`).toBe(tier);
      expect(id, `${name}: the newest ${tier} in the snapshot is ${newestOf(tier)}`).toBe(newestOf(tier));
    }
  });
});

describe("categorize-library.py: Sonnet, from the config, by Sonnet 5.5's rules", () => {
  const got = python(
    [
      "body = cat.request_body('x')",
      "thinking_first = {'stop_reason': 'end_turn', 'content': [",
      "  {'type': 'thinking', 'thinking': '', 'signature': 's'},",
      "  {'type': 'text', 'text': '```json\\n[{\"index\": 0, \"category\": \"Other\"}]\\n```'}]}",
      "def raised(result):",
      "    try:",
      "        cat.reply_text(result)",
      "        return None",
      "    except RuntimeError as e:",
      "        return str(e)",
      "print(json.dumps({",
      "  'model': cat.MODEL, 'body': body, 'reply': cat.reply_text(thinking_first),",
      "  'refusal': raised({'stop_reason': 'refusal', 'content': []}),",
      "  'cut': raised({'stop_reason': 'max_tokens', 'content': [{'type': 'thinking', 'thinking': '', 'signature': 's'}]}),",
      "}))",
    ].join("\n"),
  ) as {
    model: string;
    body: Record<string, unknown> & { messages: Array<{ role: string }> };
    reply: string;
    refusal: string | null;
    cut: string | null;
  };

  it("runs on SONNET_MODEL from the config (a categorizer on Sonnet since 2026-10-11)", () => {
    expect(got.model).toBe(config.SONNET_MODEL);
    expect(got.body.model).toBe(config.SONNET_MODEL);
  });

  it("sends no temperature, top_p or top_k (a 400 on Sonnet 5.5)", () => {
    expect(Object.keys(got.body).filter((k) => ["temperature", "top_p", "top_k"].includes(k))).toEqual([]);
  });

  it("leaves max_tokens room for thinking, at low effort", () => {
    expect(got.body.max_tokens as number).toBeGreaterThanOrEqual(8000);
    expect(got.body.output_config).toEqual({ effort: "low" });
  });

  it("ends with the user's turn: no prefill (a 400 on Sonnet 5.5)", () => {
    expect(got.body.messages.at(-1)?.role).toBe("user");
  });

  it("reads the reply by block type, past a leading thinking block", () => {
    expect(JSON.parse(got.reply)).toEqual([{ index: 0, category: "Other" }]);
  });

  it("a refusal or a reply cut off by max_tokens is an error that says so", () => {
    expect(got.refusal).toContain("refusal");
    expect(got.cut).toContain("max_tokens");
  });
});
