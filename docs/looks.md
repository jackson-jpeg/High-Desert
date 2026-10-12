# Looks: Win98 and Night (2026-10-12)

High Desert has two public looks, chosen per device:

- **Win98** (`win98`): the site in authentic gray Windows 98. The default:
  what a visitor who has never chosen gets, and what crawlers see.
- **Night** (`night`): the dark theme. Anyone can switch to it.

The old dark public look and the owner-only previews are retired. The
redesign's reasoning is in `docs/redesign-2026-10-12/`.

## How a page gets its look

1. The choice is a plain cookie, `hd_look=win98|night`, 400 days, `Path=/`,
   `SameSite=Lax` (`lookCookie()` in `src/lib/look/look.ts`). Anyone may set
   it; there is nothing to sign.
2. `next.config.ts` rewrites every page request into `src/app/[look]/...` by
   that cookie (Win98 without one), so the server renders the chosen look.
   Both looks are prerendered. There is no swap after first paint.
3. `src/proxy.ts` sends a path that names a look (`/night/library`) to the
   page's one URL, sends `/radio` to the Library's Dial mode, and deletes the
   preview era's HttpOnly `hd_look` (which script could never overwrite) and
   `hd_look_view`.
4. The root layout writes `<html data-look>` and provides the look to
   `useLook()` (`src/hooks/useLook.ts`). `pageLook()`
   (`src/lib/look/choice.ts`) reads the attribute outside React.

## Switching

`chooseLook(look)` (`src/lib/look/choice.ts`) writes the cookie, records the
choice in localStorage `hd-look-chosen`, and reloads: the router cache holds
the old look's pages, and the reload comes back rendered by the server in the
new look, with no flash. Every way in calls it:

- **Win98:** Start > Settings > Display opens Windows' **Display Properties**
  (`src/components/looks/win98/DisplayProperties.tsx`): one Appearance tab, a
  monitor previewing the scheme, the schemes as a radio group, OK, Cancel and
  Apply. Run... `desk.cpl` (or `display`) opens it too. On a phone, Start >
  Settings also holds More Settings... (the More sheet).
- **Night:** More > Display on a phone; on a desktop, View > Display... in the
  menu bar (both looks have it). It opens Night's chooser
  (`src/components/looks/NightDisplay.tsx`): a bottom sheet on a phone, a
  panel on a desktop, two cards with a thumbnail each, Cancel and Apply.
- Both use `useLookChoice()` (`src/components/looks/useLookChoice.ts`) and
  `LookPreview`. Applying the look already on screen does nothing. The choices
  are native radio buttons in a fieldset: arrows move, a screen reader hears
  the group, focus is trapped while the dialog is open, Escape closes.

## The first-visit offer

Win98 is the default, so a browser on its first visit sees a small balloon
once: **"Prefer dark?"** with **Switch to Night** and a close box
(`src/components/looks/win98/NightOffer.tsx`, mounted by `DesktopShell`).

- Only in Win98, only to a browser with no `hd_look` cookie, no
  `hd-look-chosen` and no `hd-look-offer` (`shouldOfferNight()`).
- `hd-look-offer` is written **before** it shows (`markNightOffered()`): seen,
  dismissed or accepted, it never shows again, and a browser that cannot store
  it never sees it (it would otherwise see it on every load). Browsers that
  were here before the looks shipped see it once too: they had the dark look
  and lost it.
- Client only, after hydration, and only in the app shell: show and guest
  pages, and every crawler's first paint, never carry it. It waits for the
  boot screen (`#app-loading`) to go.
- It sits above the bottom bar and the player, never over the page's main
  action. On a phone's Live screen it waits until the listener has tuned in
  (`offerHeldBack()`): that screen's first job is one Listen tap.

## What each look changes

- **CSS** goes in `src/styles/look-win98.css` / `look-night.css`, every rule
  under `html[data-look="…"]`. Colours are `--hd-*` properties (Win98's are
  `--hd-w98-*`), mirrored in `PALETTE`. Win98 re-points the canonical
  properties (the table at the top of `look-win98.css`), so most components
  need no branch at all.
- **Component swaps** are a small branch on `useLook()`: `AudioPlayer` draws
  `WinampPlayer`, `DesktopShell` draws the `Taskbar` (Start menu, tray) in
  place of the tabs, `LiveStation` draws `NotepadPhoneLines`, and the library's
  rows on a phone are dense Details rows (`EpisodeCard`, `dense`, at
  `ITEM_HEIGHT_W98_PHONE` = 52 px, against Night's 116 px cards). Win98's
  components live in `src/components/looks/win98/`.
- **The empty player** (`src/components/player/PlayerEmptyState.tsx`): with
  nothing loaded, both looks show what is on the station now (from the shared
  live store, `useOnAirSlot`) and a **Tune in** button that calls `tuneIn()`
  inside the tap. Win98 draws an idle Winamp strip, Night its mini bar. Not on
  the Live screen, whose Listen card is the phone's one tune-in control.
- **The signal meter** (the dial's, on a desktop) reads its colours from
  `--signal-*` custom properties; Win98 draws it as a progress bar, navy
  blocks in a sunken white field (16:1), where the green LEDs were 1.4:1.
- **Navigation per look** is `src/lib/look/nav.ts` (`showsNavPath`,
  `DIAL_HREF`). Radio is the Library's Dial mode in both looks.
- Server-rendered show and guest pages are CSS only (`hd-show-*` hooks).

## Measuring the looks

Every arrival, funnel step and play records the look it happened in, so an
audit can compare Win98 and Night on Live tune-ins and returns
(`docs/usage-tracking.md`, `docs/funnel.md`):

- `arrival_daily.look`: the look a session landed in.
- `funnel_daily.look`: the look a browser took each step in, with `again` for
  a step it already counted in its other look, and the `return` step (back on
  a later UTC day). `GET /api/stats/funnel` has `byLook`.
- `play_events.look`: the look of the page that sent the play.
  `GET /api/stats/usage` has `playsByLook`.

## Tests

- `src/lib/look/__tests__/`: the cookie (`look.test.ts`), choosing and the
  offer's rules (`choice.test.ts`), the proxy, navigation.
- `src/components/looks/__tests__/display-settings.test.tsx`: both Display
  settings, opened through the real shell. `win98/__tests__/night-offer.test.tsx`,
  `taskbar.test.tsx` (Start > Settings > Display by mouse and keyboard),
  `start-menu.test.ts`.
- `src/components/library/__tests__/w98-phone-rows.test.tsx`,
  `src/components/player/__tests__/player-empty-state.test.tsx`,
  `src/components/radio/__tests__/signal-meter.test.tsx` (the ratios, read
  from the stylesheets).
- `e2e/looks.spec.ts`: every screen in both looks, phone and desktop, with
  screenshots (CI artifact `look-screenshots`).
- Mutations: the `look-*` ids in `scripts/mutate-check.mjs`.
