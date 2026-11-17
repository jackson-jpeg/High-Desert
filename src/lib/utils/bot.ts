/**
 * A user agent that announces itself as a robot: a crawler, a link preview, a
 * headless browser, an uptime check. Such a request is nobody's visit. A bot
 * that lies about itself is not caught here; it is also not likely to run the
 * page's script, which is what posts a visit.
 *
 * Agents named by the sang3r.com lead (2026-11-17): HeadlessChrome (`headless`),
 * Playwright, curl, python, node (`node`, `node/x`, undici) and SangerLeadAudit.
 */
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|monitor|uptime|curl\/|wget\/|python|node-fetch|axios\/|^node(?:\/|$)|undici|playwright|sangerleadaudit/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  return !ua || BOT_UA.test(ua);
}
