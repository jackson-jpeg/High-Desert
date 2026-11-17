import { pageBuild } from "@/lib/utils/build-id";
import { pageLook } from "@/lib/look/choice";
import { SESSION_ID } from "@/lib/utils/session-id";
import { notCounted } from "./not-counted";

/**
 * A show page's listen (docs/show-pages.md, "Counting a listen").
 *
 * The show page plays through its own native `<audio>`, not the app's
 * player, so until 2026-11-17 a listen there wrote nothing: no play, no
 * presence, nothing on air. In the 30 days before, show pages had 713 desktop
 * views and 0 plays recorded (`/api/stats/usage`).
 *
 * - **One play per page load**, on the first `playing` (sound, not a press):
 *   `/api/stats/play` with surface `show`, the source the element chose
 *   (`archive` or `mirror`, from `currentSrc`) and the page's build and look.
 *   Pause and resume are the same listen, as in the app (`markListenCounted`).
 * - **A heartbeat while it plays**, every minute, carrying the show, so the
 *   listener is online and the show is on the air like any other listen. It
 *   stops on pause and on `ended`; the listening mark decays by itself.
 *   A headless checker's page sends none (`notCounted`), as everywhere.
 *
 * Plain DOM, no store: the show page is a light server page and this is all
 * the script it gets for counting.
 */

export const SHOW_HEARTBEAT_MS = 60_000;

export function sourceOf(currentSrc: string, origin: string): "archive" | "mirror" | null {
  if (!currentSrc) return null;
  let url: URL;
  try {
    url = new URL(currentSrc, origin);
  } catch {
    return null;
  }
  if (url.origin === origin && url.pathname.startsWith("/mirror/")) return "mirror";
  if (url.hostname === "archive.org" || url.hostname.endsWith(".archive.org")) return "archive";
  return null;
}

export interface ShowListenDeps {
  post: (path: string, body: Record<string, unknown>) => void;
  origin: string;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

function defaultDeps(): ShowListenDeps {
  return {
    post: (path, body) => {
      fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    },
    origin: window.location.origin,
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
  };
}

/** Watch the page's `<audio>` and count its listen. Returns the teardown. */
export function installShowListen(audio: HTMLAudioElement, episodeId: string, deps: ShowListenDeps = defaultDeps()): () => void {
  let counted = false;
  let beat: unknown = null;

  const heartbeat = () => {
    if (notCounted()) return;
    deps.post("/api/stats/heartbeat", { sessionId: SESSION_ID, episodeId });
  };
  const stopBeat = () => {
    if (beat != null) deps.clearInterval(beat);
    beat = null;
  };
  const onPlaying = () => {
    if (!counted) {
      counted = true;
      const source = sourceOf(audio.currentSrc, deps.origin);
      const build = pageBuild();
      const look = pageLook();
      deps.post("/api/stats/play", {
        episodeId,
        sessionId: SESSION_ID,
        surface: "show",
        ...(source ? { source } : {}),
        ...(build ? { build } : {}),
        ...(look ? { look } : {}),
      });
    }
    heartbeat();
    if (beat == null) beat = deps.setInterval(heartbeat, SHOW_HEARTBEAT_MS);
  };

  audio.addEventListener("playing", onPlaying);
  audio.addEventListener("pause", stopBeat);
  audio.addEventListener("ended", stopBeat);
  return () => {
    audio.removeEventListener("playing", onPlaying);
    audio.removeEventListener("pause", stopBeat);
    audio.removeEventListener("ended", stopBeat);
    stopBeat();
  };
}
