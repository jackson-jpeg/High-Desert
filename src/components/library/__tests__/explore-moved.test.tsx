import "fake-indexeddb/auto";
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Episode } from "@/db/schema";

/**
 * Smart Playlists and the Topic Index moved from /stats to the Library's
 * Explore (UI plan push 6, batch 3): they are ways into the shows.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/stats",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/library/SmartPlaylists", () => ({ SmartPlaylists: () => <section data-testid="smart-playlists">Smart Playlists</section> }));
vi.mock("@/components/library/OnThisDay", () => ({ OnThisDay: () => null }));

const { ExploreBand } = await import("../ExploreBand");

const ep = (i: number, aiTags: string[]) =>
  ({ id: i, title: `S${i}`, fileName: `${i}.mp3`, fileHash: `archive:c:${i}.mp3`, aiTags }) as unknown as Episode;
const EPISODES = [ep(1, ["ghosts", "ufos"]), ep(2, ["area 51", "ufos"]), ep(3, ["ufos", "area 51"])];

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  host?.remove();
  push.mockClear();
});

function render(expanded: boolean) {
  const h = document.createElement("div");
  document.body.appendChild(h);
  const r = createRoot(h);
  host = h;
  root = r;
  act(() => r.render(<ExploreBand expanded={expanded} onToggle={() => {}} recentlyPlayed={[]} onPlay={() => {}} episodes={EPISODES} />));
  return h;
}

describe("the Library's Explore", () => {
  it("expanded, it holds Smart Playlists and the Topic Index, tags by use", () => {
    const h = render(true);
    expect(h.querySelector('[data-testid="smart-playlists"]')).not.toBeNull();
    const tags = [...h.querySelectorAll<HTMLElement>("[data-tag]")].map((b) => b.dataset.tag);
    expect(tags).toEqual(["ufos", "area 51", "ghosts"]);
    expect(h.querySelector('[data-testid="topic-index"]')!.textContent).toContain("3 tags");
  });

  it("a tag opens the Library's search on it", () => {
    const h = render(true);
    act(() => h.querySelector<HTMLButtonElement>('[data-tag="ufos"]')!.click());
    expect(push).toHaveBeenCalledWith(expect.stringContaining("q=tag%3Aufos"));
  });

  it("collapsed, neither draws", () => {
    const h = render(false);
    expect(h.querySelector('[data-testid="topic-index"]')).toBeNull();
    expect(h.querySelector('[data-testid="smart-playlists"]')).toBeNull();
  });

  it("/stats has neither any more, and the Library passes its shows to Explore", () => {
    const stats = readFileSync(path.join(process.cwd(), "src/app/[look]/(desktop)/stats/page.tsx"), "utf8");
    expect(stats).not.toContain("<SmartPlaylists");
    expect(stats).not.toContain("Topic Index \\u00B7");
    const library = readFileSync(path.join(process.cwd(), "src/app/[look]/(desktop)/library/page.tsx"), "utf8");
    expect(library.match(/episodes=\{allEpisodes\}/g)).toHaveLength(2);
  });
});
