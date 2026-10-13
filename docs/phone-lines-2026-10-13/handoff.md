# Handoff: the Phone Lines, easy to read (2026-10-13)

Branch `ui/phone-lines-readable`, from `origin/main` 7712a6b. PR, merge and deploy: __PR__ / __DEPLOY__.

## What changed, on every surface that shows calls

Live and the Phone Lines tab (`/live?lines=1`), on phone and desktop, in both
looks: Win98's Notepad (`NotepadPhoneLines`), Night's chat (`LiveChat`, glass
on a phone, a window on a desktop), and the phone's preview of the latest three
calls on `/live` (`LinesPreview`). Mel's Hole shows no calls, so it is
untouched.

- **Each call is its own block**, with space between calls. The first line has
  the caller's name in bold, then ", calling from Asuncion" and the line in a
  quieter gray, then the time, dimmer. The message sits on its own line below,
  in normal weight. The head wraps rather than truncates, so a long name never
  runs into a place, and each "·" stays with the word before it.
  - Win98 keeps Notepad's monospace and white page:
    `Skeptic, calling from Reno · Line 3 · [10:42 PM]`, with the message below.
  - The time uses a new third-tier ink, `--hd-w98-ink-dim` (#5C5C5C: 6.7:1 on
    white).
- **Names and places no longer collide.**
  - Generated names carry no place (`services/live/lib/names.mjs`), for
    example "Sleepless Night Owl", "Prospector" or "West of the Rockies caller".
    There are about 600 plain names, and the numbered fallback still covers a
    full night.
  - A place reads "Night Owl, calling from Asuncion".
  - Stored names such as "Night Owl in Pahrump" keep working and are never
    renamed. The e2e shows one: "Night Owl in Flagstaff, calling from Tucson".
- **System notices are one small gray line.** A run of tune-ins with nothing
  between them folds into one line, such as "3 new listeners tuned in" (pure
  helper `groupTuneins`/`chatRows` in `src/lib/live/chat-rows.ts`). A call
  between two tune-ins keeps them apart.
- **Archive moments** are indented and framed (maroon in Win98, green in
  Night) under the heading "From the archive", with the "find the show" link
  inside the same block.
- **Your own calls are lightly tinted**: pale yellow with a navy edge in Win98,
  a blue tint and edge in Night, in the preview too. A call counts as yours if
  this browser posted it, or if it carries hello's `you.name` (`isOwnCall`).
- **Scrolled up, new calls never yank you down** (`src/hooks/useFollowLog.ts`).
  - A **New calls below ↓** button appears and takes you to the bottom.
  - At the bottom, the list follows new calls as before.
  - A tune-in never raises the button.
  - Your own call takes you down to it.

## Checks (all on the VPS, under nice/ionice and `heavy`)

- `tsc --noEmit`: clean. ESLint on every touched file: clean.
- Vitest, the affected files: **16 files, 306 tests passed**.
  - `chat-rows`, `live-chat`, `live-station`, the win98 folder, `names` and
    `filter` (services/live), `no-raw-hex`, store coverage.
  - New tests, each with a control:
    - `chat-rows.test.ts`: folding, adjacency, places, label, own call.
    - The "readable lines" block in `live-chat.test.tsx`: Night, desktop and
      phone.
    - `notepad-phone-lines.test.tsx`: Win98, rewritten for blocks, folding,
      archive, own call, New calls below.
    - `live-station.test.tsx`: the preview, both looks.
    - `names.test.mjs`: no place on any draw path.
  - `src/test-support/scroll-box.ts` gives jsdom real scroll numbers.
- **Mutations: 15 new (`lines-*`, `live-names-carry-no-place`), 5 re-anchored**
  (`win98-notepad-names-parts`, `chat-hide-tuneins`, `chat-tunein-in-time-order`,
  `win98-notepad-call-line`, `win98-notepad-archive-not-caller`).
  - I applied each by hand, ran its test and restored the file. **All 20
    went red.**
  - The anchors check reads `1020 mutations, 0 problems`.
- **e2e `e2e/phone-lines-busy.spec.ts`**: 12 of 12 passed against a local
  build on the e2e database.
  - Projects: desktop, mobile, and iphone (WebKit).
  - Covers win98 and night, on `/live` and `/live?lines=1`.
  - It asserts:
    - each call is a block with its head above its message;
    - the folded "3 new listeners tuned in" stays on one line;
    - the archive moment is framed, indented and labelled, with its link;
    - exactly one call is tinted as your own;
    - "New calls below" appears when scrolled up, and the list follows at the
      bottom;
    - the long call wraps.

## Screenshots

24 in `screens/` beside this file, named `<project>-<look>-<surface>.png`.

- `live` is `/live`. On a phone that is the preview; `sheet` is the preview
  tapped open.
- `lines` is `/live?lines=1`.
- `*-new-calls` is the list scrolled up, with the button showing.

Note on the iPhone shots: they read "Reconnecting..." at the bottom. That comes
from the test stub, not the app. WebKit got nothing through a request
forwarded to the spec's own SSE server, so on WebKit the stream is served
whole and then ends. Chromium's projects keep the stream open and read "On the
air".

## Not done

- Nothing from the brief is left out.
- Desktop Night still runs the chat in its Win98-shaped window, restyled by
  `look-night.css` as before. The new blocks are drawn with Tailwind tokens
  there, with no new Night CSS.

## Blocks hit this session

- The **npm-in-prod hook** blocked `cd /root/hd-lines && npm ci …; cd services/live && npm ci`.
  - Cause: after the `;`, the hook resolved the second `cd` relative to the
    live tree.
  - Fix: I re-ran it as two commands, each with an absolute `cd … &&`. Both
    installs went into the worktree.
- The **pipefail hook** blocked three commands, each a pipe without
  `set -o pipefail`.
  - The third was blocked whole, so its edit did not run.
  - Fix: I re-ran each with the prefix.
