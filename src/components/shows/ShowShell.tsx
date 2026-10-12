import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame around show, guest, topic and Tonight pages (docs/show-pages.md):
 * a server-rendered page, not the app shell. Everything on it is in the HTML
 * the server sends, so it reads, links and plays with JavaScript off.
 *
 * It is a first screen for someone who arrived from a search or a shared link,
 * so it says what the site is in one line and offers the two ways in: the
 * station (Live) and the archive (Library). Each look draws it in its own
 * chrome through the `hd-show-*` class hooks (src/styles/look-win98.css,
 * src/styles/look-night.css, src/styles/show-pages.css): Win98 a teal desktop
 * of windows, Night the dark glass of the app.
 */

/**
 * The root layout's boot screen (#app-loading) covers the page until the app
 * marks itself hydrated, or for 6 s. A show page has no app to wait for, and
 * without JavaScript nothing would ever dismiss it. Hoisted into <head> by
 * React (`precedence`), so it applies before the screen can paint.
 */
export const NO_BOOT_CSS = "#app-loading{display:none!important}";

/** The one line that says what High Desert is. */
export function siteIntro(showCount: number): string {
  return showCount > 0
    ? `High Desert plays Art Bell's late night radio free: ${showCount.toLocaleString("en-US")} shows from the archive, and a station that airs them around the clock.`
    : "High Desert plays Art Bell's late night radio free, and a station that airs it around the clock.";
}

const navLink =
  "hd-show-nav-link min-h-touch md:min-h-0 inline-flex items-center px-2 text-hd-body text-desktop-gray hover:text-desert-amber transition-colors-fast";
const footLink = "text-signal-blue hover:text-desktop-gray min-h-touch md:min-h-0 inline-flex items-center";

export function ShowShell({ children }: { children: ReactNode }) {
  const count = Number(process.env.NEXT_PUBLIC_CATALOG_COUNT || 0);
  return (
    <div className="hd-show-page min-h-dvh bg-midnight text-desktop-gray [color-scheme:dark] flex flex-col">
      <style href="hd-show-no-boot" precedence="high">
        {NO_BOOT_CSS}
      </style>
      <header className="hd-show-header w98-raised-dark bg-raised-surface">
        <div className="max-w-3xl mx-auto px-4 py-1 flex items-center gap-2">
          <Link
            href="/"
            className="hd-show-brand w98-font text-hd-title font-bold tracking-widest text-desert-amber min-h-touch md:min-h-0 inline-flex items-center mr-auto"
          >
            HIGH DESERT
          </Link>
          <nav aria-label="Site" className="hd-show-nav flex items-center gap-1">
            <Link href="/live" className={navLink}>
              Live
            </Link>
            <Link href="/library" className={navLink}>
              Library
            </Link>
            <Link href="/tonight" className={`${navLink} hidden sm:inline-flex`}>
              Tonight
            </Link>
            <Link href="/topics" className={`${navLink} hidden sm:inline-flex`}>
              Topics
            </Link>
          </nav>
        </div>
      </header>
      <div className="hd-show-intro border-b border-bevel-dark/15">
        <div className="max-w-3xl mx-auto px-4 py-2 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
          <p className="hd-show-intro-text text-hd-body text-desktop-gray flex-1">{siteIntro(count)}</p>
          <div className="hd-show-ways flex flex-wrap gap-2">
            <Link
              href="/live"
              className="hd-show-way hd-show-way-live w98-raised-dark bg-raised-surface w98-font text-hd-body text-desert-amber px-3 min-h-touch inline-flex items-center"
            >
              Listen to the station now
            </Link>
            <Link
              href="/library"
              className="hd-show-way hd-show-way-library w98-raised-dark bg-raised-surface w98-font text-hd-body text-desktop-gray px-3 min-h-touch inline-flex items-center"
            >
              Browse the Library
            </Link>
          </div>
        </div>
      </div>
      <main className="hd-show-main flex-1 w-full max-w-3xl mx-auto px-4 py-5 md:py-8">{children}</main>
      <footer className="hd-show-footer border-t border-bevel-dark/15">
        <div className="max-w-3xl mx-auto px-4 py-4 text-hd-caption text-bevel-dark flex flex-col gap-2">
          <p>High Desert is a free player for the Art Bell radio archive. The audio streams from archive.org.</p>
          <nav aria-label="More of High Desert" className="hd-show-footer-nav flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/live" className={footLink}>
              The station
            </Link>
            <Link href="/library" className={footLink}>
              Every show
            </Link>
            <Link href="/tonight" className={footLink}>
              Tonight on High Desert
            </Link>
            <Link href="/topics" className={footLink}>
              Topics
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
