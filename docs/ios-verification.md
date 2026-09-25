# iOS verification: Mobile Safari in the Simulator

2026-09-25. Driven from the VPS over the reverse tunnel. Scripts are in
`~/hd-ios-verify` on the MacBook; recordings are `ios-verify.mp4` and
`ios-verify-lock.mp4` there.

## Setup

- **Device:** iPhone 16 simulator on the iOS 26.5 runtime that was already
  installed (UDID `6A2212F7…`). Nothing was downloaded. The page reports Safari
  26.5 with a 393 px viewport.
- **Driver:** `safaridriver -p 4444` with `safari:useSimulator`. Appium and
  large installs were avoided.
  - The driver needs the GUI login context, so it has to run over
    `macbook-tunnel`. It refuses to start over Tailscale SSH.
  - Sessions don't survive between ssh logins, so each run is one Mac-side
    script, `full.sh`.
- **Probe:** each run patches `HTMLMediaElement.prototype.play` to hold on to
  the player's detached element. It logs the element's events and whether
  `navigator.userActivation.isActive` was true at each `play()`.
- **Conditions:** the Mac was under heavy load, with load average around 190
  and a second simulator booted by another session. Individual WebDriver calls
  took up to 30 s. Timings below are therefore upper bounds.

## Results

| Step | What was done | Result |
|---|---|---|
| **A. First play from a tap** | WebDriver touch-tap a row, which opens the detail sheet, then tap **Play** | Playing in **3.5 s**. Other runs took 7.1 s, and 16.9 s under the worst load. `userActivation.isActive` was `true` at `play()`. Source: archive.org |
| **A′. `play()` without a gesture** | A script-created `Audio().play()` with no tap | **Rejected, `NotAllowedError`**. The simulator enforces the autoplay policy |
| **B. Mid-play failover** | 151 MB show ("Special - Search for ET", 12,575 s). Block archive.org right after the first sound, then seek to 10,000 s | Safari fired `stalled` → `pause` → **`ended`, with no `error`** at 10,000 s. There was no failover and the element sat "finished". **See the finding below** |
| **B control** | The same seek with the network untouched | Kept playing, reaching 10,017 s after 20 s. So the `ended` in B came from the block, not from the seek |
| **C. Lock screen** | Tried ⌘L via System Events, then Simulator's **Device › Lock** menu item | **Not verified.** Neither locked the device on screen. The menu click reported success, but with two simulators booted it may have gone to the other device's window. Playback carried on in the background for 35 s (10,019 → 10,054 s), with the screen on. No pause/play from lock-screen controls could be driven |

### How archive.org was blocked

The mandate asked for a hosts override *inside the simulator*. The simulator
has no hosts file or network stack of its own: it uses the Mac's resolver and
sockets. So the block went on the Mac, which is what the simulator actually
uses:
- `0.0.0.0` and `::` entries for `archive.org`, `www.archive.org` and the
  storage node.
- A DNS cache flush.
- A `pf` anchor, `com.apple/hdverify`, that `block return`s archive.org's
  addresses. This also kills connections the hosts file can't reach, because
  they were already open.

A trap restored everything on any exit. `/etc/hosts` and `pf` were checked
clean before and after every run.

One earlier run used a 42 MB show and showed nothing: Safari had buffered the
whole file within about a minute, so the block never touched the network.
Mid-play failure tests on iOS need a long file and an early block.

## Finding: iOS reports a dropped connection as `ended`

In B, Safari gave the page an `ended` event, with `MediaError` null, 43 minutes
before the end of a show whose element knew its own length (12,574.7 s). Taken
at face value, that event:
- reset the saved position to the top,
- advanced the queue.

The listener would lose their place and hear the next show start.

**Fixed in `src/audio/ended-early.ts`.** An `ended` with no error, more than two
minutes short of the catalogued duration, is treated as a network failure. It
takes the mid-show failover path:
- the same element resumes on `/mirror/{fileHash}` at the same position;
- the listen is not counted twice;
- the queue is left alone.

Two guards keep a real ending from being caught by this:
- **The element's own duration must also say it isn't at its end.** A file that
  really is shorter than the catalog says is `duration-sanity.ts`'s case.
- **A catalogued duration of 0 decides nothing.**

The tests are in `src/hooks/__tests__/mirror-failover.test.ts` (the iOS case
plus two controls) and `src/audio/__tests__/ended-early.test.ts`. The
mutations are `ended-early-fails-over` and `ended-early-element-guard`.

## What the simulator cannot honestly represent

The simulator runs the real WebKit and the real autoplay policy, which is why A
and A′ mean something. What it cannot show:

1. **Activation from a real finger.** WebDriver's synthetic touch counts as a
   user activation here, as A shows. On a device only a real touch does. The
   code never relies on the synthetic kind, but this harness can't prove a real
   tap behaves identically.
2. **Lock screen, Control Center, AirPods and CarPlay controls.** These send
   remote commands to the page's `MediaSession` handlers (`pausePlayback` and
   `resumePlayback`, explicitly never a toggle). No lock-screen pause or play
   could be driven here; see C.
3. **Suspension after lock.** On a device, iOS throttles and can suspend the
   WebContent process once the screen locks. That affects the watchdog's timers,
   the 60 s heartbeat that keeps a listener "on air", and the 30 s position
   save. A Mac-hosted simulator is not suspended the same way.
4. **Audio session interruptions:** a phone call, Siri, another app taking
   audio, and whether playback resumes afterwards.
5. **Real networks:** a Wi-Fi to cellular handoff mid-stream, captive portals,
   and cellular latency. Here the whole network was the Mac's. B blocked a
   host; it did not drop a radio link.
6. **Low Power Mode and memory pressure.** Either can discard the tab, or cap
   buffering and prefetch.

Per the mandate, no device test has been queued. These are the gaps a real
device would close. The early-`ended` fix is written for the one gap the
simulator did expose.
