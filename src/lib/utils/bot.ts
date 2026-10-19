/**
 * A user agent that announces itself as a robot: a crawler, a link preview, a
 * headless browser, an uptime check. Such a request is nobody's visit. A bot
 * that lies about itself is not caught here; it is also not likely to run the
 * page's script, which is what posts a visit.
 */
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|monitor|uptime|curl\/|wget\/|python-|node-fetch|axios\//i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  return !ua || BOT_UA.test(ua);
}
