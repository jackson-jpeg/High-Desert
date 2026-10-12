# What changed on High Desert (2026-10-12)

## Two looks, and anyone can pick

- **Win98 is now what everyone sees.** The old look is gone.
- **Night is the dark option.** To switch:
  - in Win98: Start > Settings > Display;
  - in Night: More > Display on a phone, or View > Display on a computer.
- **The choice sticks** on that device, and the page arrives in it with no flash of the other look.
- **One-time Night offer.** A first-time visitor gets one small "Prefer dark? Switch to Night" offer. Saying no hides it for good.
- **Regulars see it once too.** People who used the site before today have no choice on record, so they also get the offer once.
- **Look tracking.** The site now records which look people use when they arrive, tune in and play, so the next audit can say which look keeps people.

## Smaller fixes in the looks

- The Win98 signal meter is easy to read now (it was gray on gray).
- On a phone, Win98's library is a proper list again, not a stack of cards.
- When nothing is playing, the player shows what's on the station now, with one tap to tune in.

## The meters on iPhone work

- **What was wrong:** on an iPhone the visualizer was solid black and the VU needles never moved. iPhones don't let the site measure the sound of the show that's playing without breaking lock-screen playback, so the meters had nothing to show.
- **What changed:** the meters now read the same file separately, quietly, in the background. That copy never makes a sound and can't touch the lock screen.
- **Where it works:** archive.org, the mirror and the repaired shows. It works in both looks, including the Winamp window.

## Sharing and Google

- **Share links:** Share now gives a show's own page (`highdesert.space/show/...`).
- **Share this moment:** shares the show at the current second. The link opens and plays from there, and its preview card says "Starts at 1:23:45".
- **Show pages** explain the site in one line and have one Play button. They also link to the live station, the Library and related shows.
- **Topic pages:** 70 of them, such as Mel's Hole, Area 51, Roswell and remote viewing, at `/topic/...` and `/topics`.
- **Tonight on High Desert** (`/tonight`): the station's program for the day in Pacific and your own time, the shows that first aired on this date, and a big Tune in. Each day has its own page and preview card, made to be posted.
- **Fixed on the way:** "Open in High Desert" from a show page used to say "That show is not in this library" to every first-time visitor.

## Live on a phone

- **One big card at the top:** what's on, who the guest is, the year, a line about why it's worth hearing, and one **Listen live** button.
- **Under it:** Call in and the last few calls.
- **Phone Lines** now has the tab Radio used to have, in both looks.

## Also

- **Continue listening** is at the top of the Library and on the welcome screen.
- **Add to Home Screen:** from a second visit, a small card offers it. On an iPhone it explains Share, then Add to Home Screen. "Not now" twice and it never comes back.
- **404s:** a missing page now shows "Signal Lost" instead of a blank screen. That page was being hidden behind the loading screen, including on the live site today.

## Before and after

Live on a phone, in `screens/`:

| | Before | After |
|---|---|---|
| Win98 | `live-phone-win98-before.png` | `live-phone-win98-after.png` |
| Night | `live-phone-night-before.png` | `live-phone-night-after.png` |

`live-phone-retired-public-look.png` is the look that was public until today.
