# Preview looks (2026-10-12)

Two candidate looks for the redesign run on production for the owner only:
**clean** (today's dark theme, refined) and **win98** (today's layout in
authentic gray Windows 98). The public look (`default`) is today's site and
must not change while they exist. The owner's guide is
`docs/redesign-2026-10-12/look-guide.md`.

## The chain (who can turn one on)

1. `POST /live-api/admin/look {look}` (services/live/lib/look.mjs): admin only
   (the phone lines' admin cookie or bearer token). Sets `hd_look` =
   `v1.<look>.<exp>.<hmac>`, `Path=/; HttpOnly; Secure; SameSite=Lax`, 30 days.
   `"default"` or anything unknown clears it.
2. The HMAC key is derived from `LIVE_ADMIN_TOKEN`
   (`lookKeyHex`). The web app holds only the derived key, `HD_LOOK_KEY` in
   `/root/.high-desert.env`, printed by
   `LIVE_ADMIN_TOKEN=… node services/live/lib/look.mjs --key`. It can verify a
   look and cannot mint an admin. Rotating the admin token turns every preview off.
3. `src/proxy.ts` runs on page requests only. Valid `hd_look`: it sets the
   script-readable `hd_look_view`. Anything else: it deletes `hd_look_view`, so
   a hand-written one is gone on the next page load. A request with neither
   cookie (every public visitor) passes through untouched. In a preview look
   `/radio` redirects to `/library?view=dial`.
4. The boot script (`src/app/boot-script.ts`) copies `hd_look_view` onto
   `<html data-look>` before first paint. Pages stay static: nothing reads a
   cookie while rendering.
5. `useLook()` (`src/hooks/useLook.ts`) is `"default"` on the server and through
   hydration, then the real look, so server HTML is always the public look's.

The switcher: `/look` (`src/app/look`, noindex, checks `/live-api/me`) and the
`LookSwitcher` pill on every page while a preview is on.

## Writing look code

- **CSS** goes in `src/styles/look-clean.css` / `look-win98.css`, every rule
  under `html[data-look="…"]`. Colours are `--hd-*` properties (win98's are
  `--hd-w98-*`), mirrored in `PALETTE`.
- **Component swaps** are a small branch on `useLook()` near the top of the
  render (`AudioPlayer` returns `WinampPlayer`, `DesktopShell` draws the
  `Taskbar` in place of the tabs, `LiveStation` draws `NotepadPhoneLines`).
  Preview components live in `src/components/looks/{clean,win98}/` and are
  `dynamic()` imports, so the public bundle does not grow by them.
- **Navigation per look** is `src/lib/look/nav.ts` (`showsNavPath`,
  `radioRetired`, `DIAL_HREF`): the shell tabs, menu bar, More sheet and
  palette all ask it.
- **Dial mode** (`src/components/library/LibraryDial.tsx`,
  `LibraryViewSwitch.tsx`, `useLibraryView`): the radio dial over the
  library's filtered episodes, `?view=dial`; ignored in the public look.
- Server-rendered show pages are CSS only (`hd-show-*` hooks).

## Tests

- `src/lib/look/__tests__/look.test.ts` holds the service's signer and the
  app's verifier to each other; `proxy.test.ts` the proxy.
- `e2e/looks.spec.ts`: every screen in every look, phone and desktop, through
  the real admin route. Asserts the public look carries no `data-look` and no
  switcher, the preview is on, no page errors, no horizontal overflow on a
  phone, no em dash in a preview. Screenshots land in `test-results/looks/`
  and CI uploads them as `look-screenshots` on every run.
- Per-look unit tests in `src/components/looks/**/__tests__`.

## Removing the looks

When one wins, it becomes the public look (move its CSS out of the
`html[data-look]` scope, make its components the default), and the other, the
proxy's look branch, `/look`, the pill and `/live-api/admin/look` are deleted.
