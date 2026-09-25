/**
 * No links, no email addresses, no phone numbers — including the spelled-out
 * and spaced-out ways people get them past a filter. The phone lines are for
 * talking to the room, not for sending it somewhere else.
 *
 * Each detector returns true for "refuse". They are tuned against what an Art
 * Bell chat actually says: years ("1997-1998"), dates ("9/25/2026"), times,
 * "Area 51", "Mr. Bell", "e.g." must all pass (test/contact.test.mjs).
 */

/**
 * TLDs recognised with a literal dot and no spaces: "example.com". Country
 * codes that are also common English words (it, in, at, be, no, am, so, la,
 * is) are left out: "that was great.it was" is a missing space, not a link.
 */
const TLDS = new Set(
  (
    "com net org edu gov mil int io co us uk ca au de fr nl ru cn jp br es se fi dk pl ch " +
    "info biz xyz me tv app dev gg ly to fm sh cc ws pw tk ml ga cf gq ai site online store club " +
    "link click top live news blog shop space fun lol wtf xxx porn sex cam onion"
  ).split(" "),
);
/**
 * TLDs recognised when the dot is disguised ("example dot com", "example . com",
 * "example(dot)com"). Only the ones nobody types by accident after a word:
 * "call . me" and "go . to" are sentences.
 */
const SPELLED_TLDS = "com|net|org|io|co|info|xyz|gg|tv|us|uk|ru|ly|biz|onion";

const DOT_SPELLED = String.raw`\s*(?:\(\s*dot\s*\)|\[\s*dot\s*\]|\{\s*dot\s*\}|<\s*dot\s*>)\s*|\s+dot\s+|\s+\.\s*|\s*\.\s+`;
const AT_SPELLED = String.raw`\s*(?:\(\s*at\s*\)|\[\s*at\s*\]|\{\s*at\s*\}|<\s*at\s*>)\s*|\s+at\s+`;

const SCHEME = /\b(?:https?|ftp|hxxps?|wss?):\/\/|\b(?:https?|hxxps?)\s*:\s*\/\s*\//i;
const WWW = /\bwww\s*(?:\.|\bdot\b)/i;
const LITERAL_DOMAIN = /\b[\p{L}\p{N}][\p{L}\p{N}-]*(?:\.[\p{L}\p{N}-]+)*\.([a-z]{2,6})\b(?!\.[\p{L}\p{N}])/giu;
const DISGUISED_DOMAIN = new RegExp(String.raw`\b[\p{L}\p{N}][\p{L}\p{N}-]*(?:${DOT_SPELLED})(?:${SPELLED_TLDS})\b`, "iu");
/** local@domain.tld — the dot is required, so leet ("b@$t@rd") and "@ 5" are not addresses. */
const EMAIL = /[\p{L}\p{N}._%+-]+\s*@\s*[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[a-z]{2,}\b/iu;
const EMAIL_SPELLED = new RegExp(
  String.raw`\b[\p{L}\p{N}._%+-]+(?:${AT_SPELLED})[\p{L}\p{N}-]+(?:${DOT_SPELLED}|\.)(?:${SPELLED_TLDS}|[a-z]{2,6})\b`,
  "iu",
);

export function hasLink(text) {
  if (SCHEME.test(text) || WWW.test(text) || DISGUISED_DOMAIN.test(text)) return true;
  for (const m of text.matchAll(LITERAL_DOMAIN)) {
    if (TLDS.has(m[1].toLowerCase())) return true;
  }
  return false;
}

export function hasEmail(text) {
  return EMAIL.test(text) || EMAIL_SPELLED.test(text);
}

const NUMBER_WORDS = {
  zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9",
};
const NUMBER_WORD_RUN = new RegExp(
  String.raw`\b(?:(?:${Object.keys(NUMBER_WORDS).join("|")})\b[\s,.-]*){7,}`,
  "gi",
);

/** A 4-digit group that reads as a year, 1900–2099. */
const YEAR = /^(?:19|20)\d\d$/;

/**
 * Seven or more digits, in groups separated only by spaces, dots, dashes,
 * parentheses or a leading +. Not "/" and not ":" — those are dates and times.
 * A run whose groups are all years, or a year plus at most two short groups
 * (a date: "9.25.2026", "12 25 1999"), is not a phone number.
 */
const DIGIT_RUN = /\+?\(?\d[\d\s.()\-]*\d/g;

function isPhoneRun(run) {
  const groups = run.split(/[^\d]+/).filter(Boolean);
  const digits = groups.join("").length;
  if (digits < 7 || digits > 15) return false;
  const years = groups.filter((g) => YEAR.test(g)).length;
  const short = groups.filter((g) => g.length <= 2).length;
  if (years === groups.length) return false; // "1997 1998", "1999-2000"
  if (years === 1 && short === groups.length - 1 && short <= 2) return false; // a date
  return true;
}

export function hasPhone(text) {
  for (const m of text.matchAll(DIGIT_RUN)) {
    if (isPhoneRun(m[0])) return true;
  }
  for (const m of text.matchAll(NUMBER_WORD_RUN)) {
    const digits = m[0]
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean)
      .map((w) => NUMBER_WORDS[w])
      .join("");
    if (digits.length >= 7) return true;
  }
  return false;
}

/** The first reason a text is refused for contact details, or null. */
export function contactReason(text) {
  if (hasEmail(text)) return "email";
  if (hasLink(text)) return "link";
  if (hasPhone(text)) return "phone";
  return null;
}
