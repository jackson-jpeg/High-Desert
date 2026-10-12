/**
 * Where a browser session came from, as one coarse word (docs/usage-tracking.md).
 *
 * Runs in the browser on the first page of a session. Its input is
 * `document.referrer` and the page's query string; its output is one of
 * ARRIVAL_SOURCES and nothing else. The referrer, its host and the URL never
 * leave the browser.
 *
 * `utm_source` wins when it names something we recognise (ChatGPT links carry
 * `utm_source=chatgpt.com` and often no referrer at all); otherwise the
 * referrer decides.
 */

import type { ArrivalSource } from "./vocab";

const AI = ["chatgpt.com", "chat.openai.com", "openai.com", "perplexity.ai", "claude.ai", "gemini.google.com", "copilot.microsoft.com", "copilot.com"];
const REDDIT = ["reddit.com", "redd.it", "reddit.app.link", "com.reddit.frontpage"];
const OTHER_SEARCH = [
  "bing.com",
  "duckduckgo.com",
  "ecosia.org",
  "search.brave.com",
  "kagi.com",
  "startpage.com",
];
const SOCIAL = [
  "facebook.com",
  "fb.com",
  "fb.me",
  "instagram.com",
  "x.com",
  "twitter.com",
  "t.co",
  "threads.net",
  "threads.com",
  "bsky.app",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "com.facebook.katana",
  "com.instagram.android",
  "com.twitter.android",
  "com.google.android.youtube",
];

/** Words a `utm_source` uses that are not hosts. */
const UTM_WORDS: Record<string, ArrivalSource> = {
  reddit: "reddit",
  google: "google",
  bing: "other-search",
  duckduckgo: "other-search",
  ddg: "other-search",
  yahoo: "other-search",
  ecosia: "other-search",
  brave: "other-search",
  kagi: "other-search",
  yandex: "other-search",
  startpage: "other-search",
  chatgpt: "ai",
  openai: "ai",
  perplexity: "ai",
  claude: "ai",
  gemini: "ai",
  copilot: "ai",
  facebook: "social",
  fb: "social",
  instagram: "social",
  ig: "social",
  twitter: "social",
  x: "social",
  threads: "social",
  bluesky: "social",
  bsky: "social",
  mastodon: "social",
  youtube: "social",
  tiktok: "social",
  lemmy: "social",
};

function under(host: string, domains: readonly string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** A host's class, or null when it is none of the named ones. */
export function classifyHost(rawHost: string): ArrivalSource | null {
  const host = rawHost.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!host) return null;
  // AI before Google: gemini.google.com is an assistant, not a search.
  if (under(host, AI)) return "ai";
  if (under(host, REDDIT)) return "reddit";
  // google.com, google.co.uk, news.google.com, and the Android search app.
  if (/(^|\.)google\.[a-z.]+$/.test(host) || host === "com.google.android.googlequicksearchbox") return "google";
  if (under(host, OTHER_SEARCH) || /(^|\.)(yahoo|yandex)\.[a-z.]+$/.test(host)) return "other-search";
  // Mastodon and Lemmy are many servers; most carry the name.
  if (under(host, SOCIAL) || /(^|\.)(mastodon|lemmy)\./.test(host)) {
    return "social";
  }
  return null;
}

/** A `utm_source` value's class, or null when it names nothing we know. */
export function classifyUtm(raw: string | null | undefined): ArrivalSource | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.includes(".")) {
    const byHost = classifyHost(v.replace(/^https?:\/\//, "").split("/")[0]);
    if (byHost) return byHost;
  }
  return UTM_WORDS[v] ?? null;
}

/** The host a referrer names, including an Android app's package (`android-app://pkg/`). */
function referrerHost(referrer: string): string {
  try {
    return new URL(referrer).hostname;
  } catch {
    return "";
  }
}

/**
 * The session's arrival class.
 *
 * @param referrer `document.referrer`
 * @param search   `location.search`
 * @param ownHost  `location.host`: a referrer from this site is `internal`
 */
export function classifyArrival(referrer: string, search: string, ownHost: string): ArrivalSource {
  let utm: string | null = null;
  try {
    utm = new URLSearchParams(search).get("utm_source");
  } catch {
    utm = null;
  }
  const byUtm = classifyUtm(utm);
  if (byUtm) return byUtm;

  if (!referrer) return utm ? "other" : "direct";
  const host = referrerHost(referrer).toLowerCase();
  if (!host) return "other";
  const own = ownHost.toLowerCase().replace(/:\d+$/, "");
  if (host === own || host === "highdesert.space" || host === "www.highdesert.space") return "internal";
  return classifyHost(host) ?? "other";
}
