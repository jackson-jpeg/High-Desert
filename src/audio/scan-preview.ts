/**
 * The radio dial's scan preview: a few seconds of a show, faded in and out,
 * played on its own element while the dial sweeps past.
 *
 * Lifted out of `(desktop)/layout.tsx`, where it had three defects (HD-014):
 *
 * - It stopped elements with `src = ""`, which resolves against the document
 *   URL — every preview ended by fetching the HTML page and trying to decode it
 *   as audio. `removeAttribute("src")` then `load()` is the only safe reset.
 * - A new preview did not clear the previous one's timers. The old fade-out
 *   timer fired on schedule and faded out whichever element was current by
 *   then, so scanning quickly cut every preview after the first short, and the
 *   fade-in intervals were never cleared at all.
 * - It set `currentTime` before the element had metadata, which engines are
 *   free to ignore; the seek now waits for `loadedmetadata`.
 *
 * Every timer and interval this creates is tracked, and starting or stopping a
 * preview clears all of them. A preview that is superseded while its `play()`
 * is still pending does nothing when that promise settles.
 */

export const PREVIEW_WINDOW_MS = 2500;
export const PREVIEW_VOLUME = 0.3;
const FADE_STEP_MS = 30;
const QUICK_FADE_STEP_MS = 20;

export interface PreviewEpisode {
  sourceUrl?: string;
  duration?: number;
}

export interface ScanPreview {
  start: (episode: PreviewEpisode) => Promise<void>;
  stop: () => void;
}

/** Where in the show to listen: skip a long show's intro, stay in its first minutes. */
export function previewOffset(duration: number | undefined, random = Math.random): number {
  return duration && duration > 120 ? 30 + random() * Math.min(duration - 60, 300) : 0;
}

function release(el: HTMLAudioElement): void {
  el.pause();
  // Never `src = ""` — see the header.
  el.removeAttribute("src");
  el.load();
}

export function createScanPreview(
  createAudio: () => HTMLAudioElement = () => new Audio(),
  random: () => number = Math.random,
): ScanPreview {
  let current: HTMLAudioElement | null = null;
  /** Elements fading out after stop(); released at once if a preview starts. */
  const fading = new Set<HTMLAudioElement>();
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  let generation = 0;

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timeouts.delete(t);
      fn();
    }, ms);
    timeouts.add(t);
  };
  const every = (fn: (stop: () => void) => void, ms: number) => {
    const t = setInterval(() => fn(stopIt), ms);
    const stopIt = () => {
      clearInterval(t);
      intervals.delete(t);
    };
    intervals.add(t);
  };

  /** Clear every timer and interval, and silence anything still fading. */
  function clearAll(): void {
    for (const t of timeouts) clearTimeout(t);
    for (const t of intervals) clearInterval(t);
    timeouts.clear();
    intervals.clear();
    for (const el of fading) release(el);
    fading.clear();
  }

  function fadeOut(el: HTMLAudioElement, step: number, stepMs: number): void {
    fading.add(el);
    every((stopIt) => {
      el.volume = Math.max(0, el.volume - step);
      if (el.volume <= 0) {
        stopIt();
        fading.delete(el);
        release(el);
      }
    }, stepMs);
  }

  async function start(episode: PreviewEpisode): Promise<void> {
    if (!episode.sourceUrl) return;
    const mine = ++generation;

    clearAll();
    if (current) {
      release(current);
      current = null;
    }

    const el = createAudio();
    el.crossOrigin = "anonymous";
    el.volume = 0;
    const offset = previewOffset(episode.duration, random);
    el.addEventListener(
      "loadedmetadata",
      () => {
        if (offset > 0) el.currentTime = offset;
      },
      { once: true },
    );
    el.src = episode.sourceUrl;
    current = el;

    try {
      await el.play();
    } catch {
      // Preview failed — not critical. Release it unless something newer has
      // already taken over (which will have released it).
      if (mine === generation && current === el) {
        release(el);
        current = null;
      }
      return;
    }
    // Superseded while play() was pending: the newer start released this one.
    if (mine !== generation) return;

    // Fade in over ~200ms
    every((stopIt) => {
      el.volume = Math.min(el.volume + 0.05, PREVIEW_VOLUME);
      if (el.volume >= PREVIEW_VOLUME) stopIt();
    }, FADE_STEP_MS);

    // Fade out once the window has been heard
    later(() => {
      if (current !== el) return;
      current = null;
      fadeOut(el, 0.05, FADE_STEP_MS);
    }, PREVIEW_WINDOW_MS);
  }

  function stop(): void {
    generation += 1;
    clearAll();
    if (current) {
      const el = current;
      current = null;
      fadeOut(el, 0.1, QUICK_FADE_STEP_MS);
    }
  }

  return { start, stop };
}
