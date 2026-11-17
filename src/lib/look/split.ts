/**
 * The phone look split (Jackson, Inbox, 2026-11-17: "Run the 50/50 split for
 * 2 weeks on new phone visitors only."). docs/funnel.md, "The phone look split".
 *
 * A new phone visitor gets Win98 or Night at random, once, and keeps it as its
 * `hd_look` cookie. Everyone else is untouched:
 *
 *   - a phone only: narrower than 768 px (the site's phone breakpoint);
 *   - new only: no `hd_look` cookie, and none of the localStorage marks a
 *     browser that has been here before carries (visitor id, funnel record,
 *     a look choice, the Night offer, the not-counted mark of our own checks);
 *   - never a crawler (crawlers stay Win98, the default);
 *   - only inside the window, SPLIT_FROM to SPLIT_UNTIL (UTC). Outside it the
 *     script does nothing, so the split ends by itself.
 *
 * A browser in the split is never offered Night (`hd-look-offer` is written
 * "split"), so the look its funnel steps record is the look it was assigned:
 * `byLook` on phones, cohorts in the window, reads as the two arms.
 *
 * It runs as an inline script in the head (LOOK_SPLIT_SCRIPT), before first
 * paint and before any app code: when the assignment is not the look the
 * server rendered (Night, since a cookie-less request renders Win98), the page
 * is hidden and replaced at once, so nothing is counted from the first copy.
 * It reloads only once the cookie is seen to have stuck, and only once per tab
 * session, so blocked cookies can never loop.
 *
 * `splitLook` must stay self-contained (no imports, no outside names): the
 * script inlines its source.
 */

/** First instant of the split (UTC). */
export const SPLIT_FROM = "2026-11-18T00:00:00Z";
/** The split's end (UTC, exclusive): two weeks after SPLIT_FROM. */
export const SPLIT_UNTIL = "2026-12-02T00:00:00Z";

/** localStorage: the arm this browser was given, "<look>@<ISO day>". */
export const LOOK_SPLIT_KEY = "hd-look-split";
/** sessionStorage: this tab already reloaded into its arm (never twice). */
export const LOOK_SPLIT_RELOAD_KEY = "hd-look-split-reloaded";

/** What a browser that has been here before carries in localStorage. */
export const PRIOR_VISIT_KEYS = [
  "hd-visitor",
  "hd-funnel",
  "hd-look-chosen",
  "hd-look-offer",
  "hd-look-split",
  "hd-not-counted",
] as const;

export interface SplitInput {
  /** Epoch ms now. */
  now: number;
  from: number;
  until: number;
  /** window.innerWidth (CSS px). */
  width: number;
  userAgent: string;
  cookie: string;
  /** Whether localStorage holds any of PRIOR_VISIT_KEYS. */
  priorVisit: boolean;
  /** A number in [0, 1). */
  random: number;
}

/**
 * The look to assign, or null when this browser is not in the split.
 * Self-contained: LOOK_SPLIT_SCRIPT inlines this function's source.
 */
export function splitLook(i: SplitInput): "win98" | "night" | null {
  if (!(i.now >= i.from && i.now < i.until)) return null;
  if (!(i.width > 0 && i.width < 768)) return null;
  if (/(?:^|;\s*)hd_look=/.test(i.cookie)) return null;
  if (i.priorVisit) return null;
  if (/bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|bingpreview|google-|mediapartners/i.test(i.userAgent)) return null;
  return i.random < 0.5 ? "night" : "win98";
}

/** 400 days, as LOOK_COOKIE_MAX_AGE (src/lib/look/look.ts). */
const MAX_AGE = 400 * 24 * 60 * 60;

/**
 * The inline head script. Every storage access is in try/catch: blocked
 * storage is normal (private windows, Safari with cookies blocked), and then
 * the browser is simply not in the split.
 */
export const LOOK_SPLIT_SCRIPT = `(function(){try{var d=document,h=d.documentElement,ls=window.localStorage,p=false,k=${JSON.stringify(PRIOR_VISIT_KEYS)};for(var j=0;j<k.length;j++){if(ls.getItem(k[j])!==null)p=true}var l=(${splitLook.toString()})({now:Date.now(),from:Date.parse(${JSON.stringify(SPLIT_FROM)}),until:Date.parse(${JSON.stringify(SPLIT_UNTIL)}),width:window.innerWidth,userAgent:navigator.userAgent||"",cookie:d.cookie,priorVisit:p,random:Math.random()});if(!l)return;ls.setItem(${JSON.stringify(LOOK_SPLIT_KEY)},l+"@"+new Date().toISOString().slice(0,10));ls.setItem("hd-look-offer","split");d.cookie="hd_look="+l+"; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"");if(l===h.getAttribute("data-look"))return;if(!/(?:^|;\\s*)hd_look=/.test(d.cookie))return;var ss=window.sessionStorage;if(ss.getItem(${JSON.stringify(LOOK_SPLIT_RELOAD_KEY)}))return;ss.setItem(${JSON.stringify(LOOK_SPLIT_RELOAD_KEY)},"1");h.style.visibility="hidden";location.replace(location.href)}catch(e){}})();`;
