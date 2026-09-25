/**
 * Words: what is refused outright, what is masked, and how evasions are seen
 * through. Built on `obscenity` (docs/live-chat.md, "Why obscenity"), whose
 * matcher already resolves Unicode lookalikes (Cyrillic/Greek homoglyphs),
 * leetspeak (4→a 3→e 1→i 0→o 5→s @→a $→s …), case and repeated letters, and
 * keeps whitelisted words (Scunthorpe, assassin, classic …) out of it.
 *
 * Two things it deliberately does not do by default, and this file adds:
 *
 *   - **Spacing and punctuation tricks** ("w o r d", "w.o.r.d", "wo-rd").
 *     obscenity leaves `skipNonAlphabeticTransformer` off because skipping
 *     spaces everywhere joins innocent neighbours into words. Instead a second
 *     view of the text is matched: punctuation *inside* a token is dropped, and
 *     runs of two or more single-character tokens are joined. Everything else
 *     keeps its spaces, so "an alysis" is not "analysis" and "skill you" is
 *     not "kill you".
 *   - **Accents** ("fück"): stripped (NFD, marks removed) in the matching copy.
 *
 * Categories: the dataset's words are BLOCK (slurs, sexual terms) unless listed
 * in MASK_WORDS (mild profanity), which are replaced with asterisks. The project
 * blocklist (data/chat-blocklist.txt) adds threats, hate phrases and anything
 * the owner adds, each marked block, mask or allow.
 *
 * Indices: obscenity reports inclusive UTF-16 [start, end] in the string it was
 * given. Both views carry a map back to the message as stored, so masking lands
 * on the characters the reader sees.
 */

import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedBlacklistMatcherTransformers,
  englishRecommendedWhitelistMatcherTransformers,
  parseRawPattern,
} from "obscenity";

/**
 * Mild profanity: masked, not refused. Every other word in obscenity's English
 * dataset (slurs and sexual terms) refuses the message. Matched on the
 * dataset's `originalWord`, so "fvck" and "sh1t" land here too.
 */
export const MASK_WORDS = new Set([
  "fuck", "shit", "ass", "arse", "bastard", "bitch", "piss", "bollocks", "prick", "wank", "turd", "cuck",
  // Also a common given name (Dick Clark, Philip K. Dick): masked as an insult,
  // not refused as a sexual term. Catalog guests are allowed outright in the blocklist.
  "dick",
]);

/** A character that can be part of a word, including the leet symbols. */
const CORE = /[\p{L}\p{N}@$!|]/u;
const SPACE = /\s/u;

/**
 * Lookalikes obscenity's own table does not fold: Greek letters, and the
 * Cyrillic ones it misses. Applied in the matching copy only; what the room
 * reads is what was typed.
 */
const LOOKALIKES = new Map(
  Object.entries({
    // Greek
    "\u03b1": "a", "\u03b2": "b", "\u03b3": "y", "\u03b5": "e", "\u03b7": "n", "\u03b9": "i", "\u03ba": "k",
    "\u03bd": "v", "\u03bf": "o", "\u03c1": "p", "\u03c4": "t", "\u03c5": "u", "\u03c7": "x", "\u03c9": "w",
    "\u0391": "a", "\u0392": "b", "\u0395": "e", "\u0396": "z", "\u0397": "h", "\u0399": "i", "\u039a": "k",
    "\u039c": "m", "\u039d": "n", "\u039f": "o", "\u03a1": "p", "\u03a4": "t", "\u03a5": "y", "\u03a7": "x",
    // Cyrillic
    "\u0430": "a", "\u0432": "b", "\u0435": "e", "\u043a": "k", "\u043c": "m", "\u043d": "h", "\u043e": "o",
    "\u0440": "p", "\u0441": "c", "\u0442": "t", "\u0443": "y", "\u0445": "x", "\u0456": "i", "\u0458": "j",
    "\u0455": "s", "\u0501": "d", "\u04bb": "h", "\u04cf": "l", "\u0457": "i", "\u0491": "r",
    "\u0410": "a", "\u0412": "b", "\u0415": "e", "\u041a": "k", "\u041c": "m", "\u041d": "h", "\u041e": "o",
    "\u0420": "p", "\u0421": "c", "\u0422": "t", "\u0423": "y", "\u0425": "x", "\u0406": "i", "\u0408": "j",
    "\u0405": "s",
  }),
);

/** The text with accents stripped and lookalikes folded, and a map from each UTF-16 unit back to the source index. */
export function matchView(text) {
  let s = "";
  const map = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const folded = LOOKALIKES.get(ch);
    const base = folded ?? (ch.normalize("NFD").replace(/\p{M}/gu, "") || (/\p{M}/u.test(ch) ? "" : ch));
    for (let k = 0; k < base.length; k++) {
      s += base[k];
      map.push(i);
    }
    i += ch.length;
  }
  return { s, map };
}

/**
 * The second view: punctuation inside a token removed, runs of single-character
 * tokens joined. "f.u.c.k" → "fuck", "f u c k you" → "fuck you".
 */
export function despacedView({ s, map }) {
  // Tokens: maximal non-space runs, with their positions in `s`.
  const tokens = [];
  for (let i = 0; i < s.length; ) {
    if (SPACE.test(s[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < s.length && !SPACE.test(s[j])) j++;
    tokens.push({ start: i, end: j });
    i = j;
  }
  // Inside each token keep core chars, plus any punctuation before the first
  // or after the last core char ("word," stays a word followed by a comma).
  const cooked = tokens.map(({ start, end }) => {
    let first = -1;
    let last = -1;
    for (let k = start; k < end; k++) {
      if (CORE.test(s[k])) {
        if (first < 0) first = k;
        last = k;
      }
    }
    const chars = [];
    for (let k = start; k < end; k++) {
      if (first >= 0 && k > first && k < last && !CORE.test(s[k])) continue;
      chars.push(k);
    }
    const core = chars.filter((k) => CORE.test(s[k]));
    return { chars, core };
  });
  let out = "";
  const outMap = [];
  const push = (k) => {
    out += s[k];
    outMap.push(map[k]);
  };
  for (let t = 0; t < cooked.length; t++) {
    const single = (x) => x && x.core.length === 1;
    if (single(cooked[t]) && single(cooked[t + 1])) {
      // A run of single characters: emit only their core characters, joined.
      let u = t;
      while (single(cooked[u])) {
        push(cooked[u].core[0]);
        u++;
      }
      t = u - 1;
    } else {
      for (const k of cooked[t].chars) push(k);
    }
    if (t < cooked.length - 1) {
      out += " ";
      outMap.push(outMap[outMap.length - 1] ?? 0);
    }
  }
  return { s: out, map: outMap };
}

/**
 * The matcher's chain without its final repeat-collapse: lookalikes, leet,
 * lower-case. Used where the runs themselves are the evidence.
 */
const PRE_COLLAPSE = englishRecommendedBlacklistMatcherTransformers.slice(0, -1);

/** Every run of one character cut to a single character; letters only. */
function skeleton(s) {
  return s.replace(/[^a-z ]/g, "").replace(/(.)\1+/g, "$1");
}

/** Run a string through obscenity's transformer chain, as the matcher does to input. */
function transformString(text, transformers) {
  const stateful = transformers.map((t) => (t.type === 1 ? t.factory() : null));
  let out = "";
  for (const ch of text) {
    let c = ch.codePointAt(0);
    for (let i = 0; i < transformers.length && c !== undefined; i++) {
      c = transformers[i].type === 0 ? transformers[i].transform(c) : stateful[i].transform(c);
    }
    if (c !== undefined) out += String.fromCodePoint(c);
  }
  return out;
}

/**
 * A blocklist term, normalised exactly as a message is before matching: the
 * same accent strip, the same token rules (punctuation inside words dropped),
 * then the matcher's own transformer chain. What is left is a pattern body.
 */
export function termToPatternBody(term) {
  const { s, map } = matchView(String(term).normalize("NFKC"));
  const despaced = despacedView({ s, map }).s;
  const transformed = transformString(despaced, englishRecommendedBlacklistMatcherTransformers);
  return transformed.replace(/[^a-z0-9 ]/g, "").replace(/ +/g, " ").trim();
}

/**
 * A term made only of digits ("1488", "14 88") is matched as digits, never
 * through the matcher: its leet map turns 1 and 4 into letters but leaves 8
 * alone, and its repeat-collapse then folds "88" to "8" — so "1488" became
 * "148" and refused "route 148". Digits must match digit for digit; any
 * spacing or punctuation between them is allowed, and a longer number that
 * merely contains the digits is not a match.
 */
const NUMERIC_TERM = /^[0-9][0-9 ]*$/;
function numericPattern(term) {
  const digits = term.replace(/ /g, "").split("");
  return new RegExp(`(?<![0-9])${digits.join("[^0-9\\p{L}]*")}(?![0-9])`, "gu");
}

/** @param {import("./blocklist.mjs").BlocklistEntry[]} entries */
export function createProfanityFilter(entries = []) {
  const dataset = new DataSet().addAll(englishDataset);
  const allow = [];
  /** @type {{ re: RegExp, category: string }[]} */
  const numeric = [];
  for (const e of entries) {
    if (e.kind === "allow") {
      const t = transformString(matchView(e.term.normalize("NFKC")).s, englishRecommendedWhitelistMatcherTransformers);
      if (t.trim()) allow.push(t.trim());
      continue;
    }
    if (NUMERIC_TERM.test(e.term)) {
      numeric.push({ re: numericPattern(e.term), category: e.kind });
      continue;
    }
    const body = termToPatternBody(e.term);
    if (!body) continue;
    const raw = `${e.prefix ? "" : "|"}${body}${e.suffix ? "" : "|"}`;
    dataset.addPhrase((p) =>
      p.setMetadata({ originalWord: e.term, category: e.kind, project: true }).addPattern(parseRawPattern(raw)),
    );
  }
  const built = dataset.build();
  const matcher = new RegExpMatcher({
    blacklistedTerms: built.blacklistedTerms,
    whitelistedTerms: [...(built.whitelistedTerms ?? []), ...allow],
    blacklistMatcherTransformers: englishRecommendedBlacklistMatcherTransformers,
    whitelistMatcherTransformers: englishRecommendedWhitelistMatcherTransformers,
  });

  // Stretched words. The matcher's repeat-collapsing keeps doubles for letters
  // that are legitimately doubled (gg, ee, oo, ss, ll, bb), so tripling one of
  // those ("nnniiigggeeerrr") slips past it. A token that contains a run of
  // three or more identical letters is compared by its *skeleton* (every run
  // cut to one letter) against the skeletons of single-word terms. Only such
  // tokens: an ordinary word whose skeleton collides with a term's is left
  // alone, because it shows no sign of stretching.
  const skeletons = new Map();
  /** Multi-word terms ("heil hitler"): refused if their skeleton appears word-aligned. */
  const phraseSkeletons = [];
  const addSkeleton = (word, category) => {
    const sk = skeleton(transformString(String(word).toLowerCase(), PRE_COLLAPSE)).trim();
    if (sk.length < 3) return;
    if (sk.includes(" ")) {
      if (category === "block") phraseSkeletons.push(sk);
    } else if (!skeletons.has(sk)) skeletons.set(sk, category);
  };
  for (const t of built.blacklistedTerms) {
    const meta = dataset.getPayloadWithPhraseMetadata({ termId: t.id, startIndex: 0, endIndex: 0, matchLength: 0 })
      .phraseMetadata ?? {};
    if (meta.originalWord) addSkeleton(meta.originalWord, meta.project ? meta.category : MASK_WORDS.has(meta.originalWord) ? "mask" : "block");
  }

  function stretched(view) {
    const out = [];
    const whole = transformString(view.s, PRE_COLLAPSE);
    if (phraseSkeletons.length && /(\p{L})\1\1/u.test(whole)) {
      const sk = ` ${skeleton(whole).replace(/ +/g, " ").trim()} `;
      if (phraseSkeletons.some((p) => sk.includes(` ${p} `))) {
        out.push({ category: "block", from: 0, last: view.map[view.map.length - 1] ?? 0 });
      }
    }
    for (let i = 0; i < view.s.length; ) {
      if (SPACE.test(view.s[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < view.s.length && !SPACE.test(view.s[j])) j++;
      const t = transformString(view.s.slice(i, j), PRE_COLLAPSE);
      if (/(.)\1\1/u.test(t)) {
        const sk = skeleton(t);
        const cat = skeletons.get(sk) ?? (sk.endsWith("s") ? skeletons.get(sk.slice(0, -1)) : undefined);
        if (cat) out.push({ category: cat, from: view.map[i], last: view.map[j - 1] });
      }
      i = j;
    }
    return out;
  }

  function categoryOf(match) {
    const meta = dataset.getPayloadWithPhraseMetadata(match).phraseMetadata ?? {};
    if (meta.project) return meta.category;
    return MASK_WORDS.has(meta.originalWord) ? "mask" : "block";
  }

  /**
   * @returns {{ blocked: boolean, masked: string, hits: number }}
   *   `masked` is `text` with every mask-category match's visible characters
   *   replaced by `*`. When `blocked` it is irrelevant: the message is refused.
   */
  function check(text) {
    const v0 = matchView(text);
    const v1 = despacedView(v0);
    const maskAt = new Set();
    let blocked = false;
    let hits = 0;
    const take = (category, from, lastSrc) => {
      hits++;
      if (category === "block") {
        blocked = true;
        return;
      }
      const to = lastSrc + String.fromCodePoint(text.codePointAt(lastSrc)).length;
      for (let k = from; k < to; k++) maskAt.add(k);
    };
    for (const view of [v0, v1]) {
      for (const m of matcher.getAllMatches(view.s)) {
        take(categoryOf(m), view.map[m.startIndex], view.map[m.endIndex]);
      }
    }
    for (const s of stretched(v1)) take(s.category, s.from, s.last);
    for (const { re, category } of numeric) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) take(category, m.index, m.index + m[0].length - 1);
    }
    if (blocked || maskAt.size === 0) return { blocked, masked: text, hits };
    let masked = "";
    for (let i = 0; i < text.length; ) {
      const ch = String.fromCodePoint(text.codePointAt(i));
      masked += maskAt.has(i) && !SPACE.test(ch) ? "*" : ch;
      i += ch.length;
    }
    return { blocked, masked, hits };
  }

  return { check };
}
