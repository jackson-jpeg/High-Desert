import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Episode, HistoryEntry } from "@/db/schema";
import { communityKey } from "@/lib/utils/community-key";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ep = (id: number, guestName: string) =>
  ({ id, title: `Show ${id}`, fileName: `s${id}.mp3`, fileHash: `archive:c:s${id}.mp3`, archiveIdentifier: "c", guestName }) as unknown as Episode;
const EPISODES = [ep(1, "Bob Lazar"), ep(2, "Mel Waters"), ep(3, "Mel Waters")];
let community = new Map<string, { plays: number; avg: number; count: number }>();
vi.mock("@/hooks/useCommunityCatalog", () => ({ useCommunityCatalog: () => community }));

const { YouAndTheDesert } = await import("../YouAndTheDesert");

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  host?.remove();
});

function render(history: HistoryEntry[]) {
  const h = document.createElement("div");
  document.body.appendChild(h);
  const r = createRoot(h);
  host = h;
  root = r;
  act(() => r.render(<YouAndTheDesert episodes={EPISODES} history={history} />));
  return h;
}

describe("You and the desert", () => {
  it("heard X of N, your top guest beside the station's", () => {
    community = new Map([[communityKey(EPISODES[1])!, { plays: 30, avg: 0, count: 0 }]]);
    const h = render([{ episodeId: 1, timestamp: 1, duration: 5_400 }]);
    expect(h.querySelector('[data-you="heard"]')!.textContent).toBe("You've heard 1 of 3 shows (33%).");
    const g = h.querySelector('[data-you="guest"]')!.textContent!;
    expect(g).toContain("Bob Lazar");
    expect(g).toContain("1.5h heard");
    expect(g).toContain("The station's: Mel Waters (30 plays)");
  });

  it("the same guest says so", () => {
    community = new Map([[communityKey(EPISODES[0])!, { plays: 3, avg: 0, count: 0 }]]);
    const h = render([{ episodeId: 1, timestamp: 1, duration: 600 }]);
    expect(h.querySelector('[data-you="guest"]')!.textContent).toContain("the station's too");
  });

  it("is on the You tab", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[look]/(desktop)/stats/page.tsx"), "utf8");
    expect(page).toContain("<YouAndTheDesert episodes={episodes ?? []} history={history ?? []} />");
    expect(page.indexOf("<RatingsReport />")).toBeGreaterThan(page.indexOf("function StationPanel"));
    expect(page.indexOf("<RatingsReport />")).toBeLessThan(page.indexOf("<OnAir />"));
  });
});
