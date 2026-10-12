import type { Metadata } from "next";

/**
 * Google Search Console's ownership check, as a meta tag
 * (`<meta name="google-site-verification">`), from the environment variable
 * GOOGLE_SITE_VERIFICATION (docs/show-pages.md, "Search Console").
 *
 * Absent or malformed means no tag at all. The root layout is rendered at
 * build time, so the variable must be in the build's environment:
 * scripts/deploy.sh passes it through from /root/.high-desert.env.
 */
const TOKEN = /^[A-Za-z0-9_-]{10,100}$/;

export function siteVerification(env: Record<string, string | undefined> = process.env): Metadata["verification"] {
  // An env file may quote the value; the token itself never contains a quote.
  const token = env.GOOGLE_SITE_VERIFICATION?.trim().replace(/^["']|["']$/g, "");
  return token && TOKEN.test(token) ? { google: token } : undefined;
}
