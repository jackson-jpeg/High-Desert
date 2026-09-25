/**
 * data/chat-blocklist.txt — the project's own terms, on top of the library's
 * dataset. The owner extends it; the syntax is deliberately small:
 *
 *   # a comment (whole line, or after " #")
 *   term               block the whole word or phrase
 *   *term              ...also at the end of a longer word
 *   term*              ...also at the start of a longer word
 *   *term*             ...anywhere, even inside other words (careful: Scunthorpe)
 *   mask: term         replace it with asterisks instead of refusing the message
 *   allow: term        never flag this word (a false-positive fix, e.g. pussycat)
 *   b64:BASE64         the term, base64-encoded, for anything you would rather
 *                      not have readable in the repo. Combines: "mask: b64:..."
 *
 * Every term goes through the same normalisation as a message (NFKC, case,
 * accents, leetspeak, lookalikes, repeated letters) — see profanity.mjs — so
 * "k1ll y0u" in the file and "KILL   YOU" in a message meet in the middle.
 *
 * Reloaded on SIGHUP and whenever the file's mtime changes (checked at most
 * every few seconds, on use). A file that fails to parse keeps the previous list.
 */

import { readFileSync, statSync } from "node:fs";

/** @typedef {{ kind: "block" | "mask" | "allow", term: string, prefix: boolean, suffix: boolean, line: number }} BlocklistEntry */

/** @returns {{ entries: BlocklistEntry[], errors: string[] }} */
export function parseBlocklist(text) {
  const entries = [];
  const errors = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, i) => {
    let line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) return;
    let kind = "block";
    const kindMatch = /^(mask|allow|block):\s*/i.exec(line);
    if (kindMatch) {
      kind = kindMatch[1].toLowerCase();
      line = line.slice(kindMatch[0].length).trim();
    }
    if (/^b64:/i.test(line)) {
      const decoded = Buffer.from(line.slice(4).trim(), "base64").toString("utf8");
      if (!decoded.trim()) {
        errors.push(`line ${i + 1}: b64 term decodes to nothing`);
        return;
      }
      line = decoded.trim();
    }
    const prefix = line.startsWith("*");
    const suffix = line.endsWith("*") && line.length > 1;
    const term = line.replace(/^\*+|\*+$/g, "").trim();
    if (!term) {
      errors.push(`line ${i + 1}: empty term`);
      return;
    }
    entries.push({ kind, term, prefix, suffix, line: i + 1 });
  });
  return { entries, errors };
}

/**
 * A blocklist that notices when its file changes. `get()` is cheap: it stats
 * the file at most once per `checkEveryMs` and reparses only on a new mtime.
 */
export function watchedBlocklist(file, { checkEveryMs = 5_000, onReload = () => {}, now = Date.now } = {}) {
  let entries = [];
  let mtimeMs = -1;
  let checkedAt = -Infinity;
  let version = 0;

  function load(force = false) {
    let st;
    try {
      st = statSync(file);
    } catch {
      if (mtimeMs !== 0) {
        entries = [];
        mtimeMs = 0;
        version++;
        onReload({ entries, errors: [`${file} not found`], version });
      }
      return;
    }
    if (!force && st.mtimeMs === mtimeMs) return;
    const parsed = parseBlocklist(readFileSync(file, "utf8"));
    entries = parsed.entries;
    mtimeMs = st.mtimeMs;
    version++;
    onReload({ ...parsed, version });
  }

  return {
    get() {
      const t = now();
      if (t - checkedAt >= checkEveryMs) {
        checkedAt = t;
        load();
      }
      return { entries, version };
    },
    reload() {
      checkedAt = now();
      load(true);
      return { entries, version };
    },
  };
}
