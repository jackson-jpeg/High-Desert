import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame around show and guest pages (docs/show-pages.md): a light,
 * server-rendered page, not the app shell. Everything on it is in the HTML
 * the server sends, so it reads, links and plays with JavaScript off.
 *
 * Class hooks are prefixed `hd-show-`: preview looks restyle these pages
 * through `html[data-look=...] .hd-show-*` (docs/looks.md).
 */

/**
 * The root layout's boot screen (#app-loading) covers the page until the app
 * marks itself hydrated, or for 6 s. A show page has no app to wait for, and
 * without JavaScript nothing would ever dismiss it. Hoisted into <head> by
 * React (`precedence`), so it applies before the screen can paint.
 */
export const NO_BOOT_CSS = "#app-loading{display:none!important}";

const navLink =
  "hd-show-nav-link min-h-touch md:min-h-0 inline-flex items-center px-2 text-hd-body text-desktop-gray hover:text-desert-amber transition-colors-fast";

export function ShowShell({ children }: { children: ReactNode }) {
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
            <Link href="/library" className={navLink}>
              Library
            </Link>
            <Link href="/live" className={navLink}>
              Live
            </Link>
          </nav>
        </div>
      </header>
      <main className="hd-show-main flex-1 w-full max-w-3xl mx-auto px-4 py-5 md:py-8">{children}</main>
      <footer className="hd-show-footer border-t border-bevel-dark/15">
        <div className="max-w-3xl mx-auto px-4 py-4 text-hd-caption text-bevel-dark">
          High Desert is a free player for the Art Bell radio archive. The audio streams from archive.org.{" "}
          <Link href="/library" className="text-signal-blue hover:text-desktop-gray">
            Browse every show
          </Link>
          .
        </div>
      </footer>
    </div>
  );
}
