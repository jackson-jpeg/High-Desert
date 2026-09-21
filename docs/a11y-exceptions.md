# Accessibility exceptions

What `e2e/a11y.spec.ts` knowingly does not fail on, one line each, with the
reason. The spec runs axe-core on `/library`, `/library` with its modal open,
`/radio` and `/stats`, at the desktop and phone sizes, and fails on any
**serious** or **critical** violation. A selector excluded there must have a
line here; the spec's `EXCLUDED` list and this file are kept in step.

## Excluded from the scan

**None.** As of 2026-09-21 every page scans clean at serious/critical with
nothing excluded.

## Reported, not failed (moderate)

- `page-has-heading-one` on `/library` and `/radio` (`/stats` too until its
  Window heading renders): the Win98 shell has window title bars, not a page
  heading. Printed on every run so it stays visible; not a WCAG A/AA failure.

## Lint: `hd/text-opacity-floor` disables

Each `eslint-disable-next-line hd/text-opacity-floor` in `src/` carries a
comment saying why the element holds no readable text (a decorative glyph that
is `aria-hidden`, a texture, the ASCII logotype, signal bars, a row mid-drag,
the scanner's inactive drop zone). `grep -rn "hd/text-opacity-floor" src` lists
them.
