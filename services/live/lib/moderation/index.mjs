/**
 * The one judgement a message or a name goes through. Server-side only, no AI:
 * normalisation (normalize.mjs), contact details (contact.mjs), words
 * (profanity.mjs + data/chat-blocklist.txt).
 *
 * Reasons (the client shows a sentence for each; see REASON_TEXT):
 *   empty, too-long, link, email, phone, blocked
 *   names also: name-too-short, name-too-long, name-chars, name-reserved, name-profane
 */

import { MAX_MESSAGE_CHARS, MAX_NAME_CHARS, MIN_NAME_CHARS } from "../config.mjs";
import { normalizeText, codePointLength } from "./normalize.mjs";
import { contactReason } from "./contact.mjs";
import { createProfanityFilter } from "./profanity.mjs";

export const REASON_TEXT = {
  empty: "Say something first.",
  "too-long": `Keep it to ${MAX_MESSAGE_CHARS} characters.`,
  link: "Links can't go on the air.",
  email: "Email addresses can't go on the air.",
  phone: "Phone numbers can't go on the air.",
  blocked: "That can't go on the air.",
  "name-too-short": `Names need at least ${MIN_NAME_CHARS} characters.`,
  "name-too-long": `Names can be at most ${MAX_NAME_CHARS} characters.`,
  "name-chars": "Names can use letters, numbers, spaces and - ' . , &",
  "name-reserved": "That name is reserved.",
  "name-profane": "Pick a name the whole room can hear.",
};

/** Names nobody may take: the host, and anything that reads as staff. */
const RESERVED = [
  /\bart\s*bell\b/i,
  /\badmin/i,
  /\bmod(?:erator)?s?\b/i,
  /\bstaff\b/i,
  /\bofficial\b/i,
  // "Farmhand in the High Desert" is a caller; "High Desert" alone is the site talking.
  /^(?:the\s+)?high\s*desert$/i,
  /^(?:the\s+)?host$/i,
];

/**
 * A moderator bound to a blocklist source. `blocklist()` returns
 * `{entries, version}`; the filter is rebuilt only when the version moves.
 */
export function createModerator(blocklist = () => ({ entries: [], version: 0 })) {
  let built = null;
  let builtVersion = -1;
  function filter() {
    const { entries, version } = blocklist();
    if (!built || version !== builtVersion) {
      built = createProfanityFilter(entries);
      builtVersion = version;
    }
    return built;
  }

  /** @returns {{ ok: true, text: string } | { ok: false, reason: string }} */
  function message(raw) {
    const text = normalizeText(raw);
    if (!text) return { ok: false, reason: "empty" };
    if (codePointLength(text) > MAX_MESSAGE_CHARS) return { ok: false, reason: "too-long" };
    const contact = contactReason(text);
    if (contact) return { ok: false, reason: contact };
    const words = filter().check(text);
    if (words.blocked) return { ok: false, reason: "blocked" };
    return { ok: true, text: words.masked };
  }

  /** Names pass the same filter, but nothing is masked: a name that needs asterisks is refused. */
  function name(raw) {
    const text = normalizeText(raw);
    const len = codePointLength(text);
    if (len < MIN_NAME_CHARS) return { ok: false, reason: "name-too-short" };
    if (len > MAX_NAME_CHARS) return { ok: false, reason: "name-too-long" };
    if (!/^[\p{L}\p{N}][\p{L}\p{N} '.,&-]*$/u.test(text)) return { ok: false, reason: "name-chars" };
    if (RESERVED.some((r) => r.test(text))) return { ok: false, reason: "name-reserved" };
    const contact = contactReason(text);
    if (contact) return { ok: false, reason: contact };
    if (filter().check(text).hits > 0) return { ok: false, reason: "name-profane" };
    return { ok: true, text };
  }

  return { message, name };
}
