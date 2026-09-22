# Accessibility exceptions

What `e2e/a11y.spec.ts` knowingly does not fail on, one line each, with the
reason. The spec runs axe-core on `/`, `/library`, `/library` with its modal
open (palette on desktop, menu sheet on a phone), `/radio`, `/stats`, and — as
an admin — `/scanner` and `/search`, at the desktop and phone sizes, and fails
on any **moderate**, **serious** or **critical** violation (moderate since
2026-09-22). It also asserts every route, the 404 included, has exactly one
`h1` with its expected text. A selector excluded there must have a line here;
the spec's `EXCLUDED` list and this file are kept in step.

## Excluded from the scan

**None.** As of 2026-09-22 every page scans clean at moderate/serious/critical
with nothing excluded.

## Reported, not failed (minor)

Minor findings are printed on every run and do not fail it. None are expected;
anything that appears there should be read, not scrolled past.

## Fixed when the gate reached moderate (2026-09-22)

- `page-has-heading-one` on `/library`, `/radio` and `/stats`: the Win98 shell
  has title bars, not a page heading. Each route now has one `h1` — a visually
  hidden one from the route's layout (`RouteHeading`) where the chrome has no
  title, and the visible title where there is one (`/scanner`'s "Import
  Sources", `/search`'s "Search Archive.org" window, the 404's "Signal Lost").
  `/stats` had an `h1` only in its loading and empty states.
- `landmark-one-main` and `region` on `/`: the welcome page renders outside the
  shell and had no landmark at all. Its content is now a `<main>`.

## Lint: `hd/text-opacity-floor` disables

Each `eslint-disable-next-line hd/text-opacity-floor` in `src/` carries a
comment saying why the element holds no readable text (a decorative glyph that
is `aria-hidden`, a texture, the ASCII logotype, signal bars, a row mid-drag,
the scanner's inactive drop zone). `grep -rn "hd/text-opacity-floor" src` lists
them.
