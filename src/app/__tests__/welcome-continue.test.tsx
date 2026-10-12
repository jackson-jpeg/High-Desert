import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Episode } from "@/db/schema";

/**
 * Continue listening on the welcome page: the page has no player, so a tap
 * goes to the Library with a `?resume=` intent, which starts the show on the
 * ordinary play path at its saved second (useLibraryIntents, tested in
 * src/hooks/__tests__/library-intents.test.tsx). The card itself is tested in
 * src/components/library/__tests__/continue-listening.test.tsx; here it is a
 * stub, so this file holds the page's wiring only.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/db", () => ({ db: { episodes: { count: async () => 0 } } }));
const show = vi.hoisted(() => ({
  id: 7,
  fileHash: "archive:coast-to-coast-am:1997-03-13.mp3",
  archiveIdentifier: "coast-to-coast-am",
  fileName: "1997-03-13.mp3",
  title: "Phoenix Lights",
}));
vi.mock("@/components/library/ContinueListening", () => ({
  ContinueListening: ({ onResume }: { onResume: (ep: Episode) => void }) =>
    createElement("button", { "data-testid": "continue-resume", onClick: () => onResume(show as unknown as Episode) }, "Resume"),
}));
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const { default: WelcomePage } = await import("../[look]/page");
const { communityKey } = await import("@/lib/utils/community-key");
const { libraryIntentHref } = await import("@/lib/library/intents");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Continue listening on the welcome page", () => {
  it("resumes through the Library's resume intent at once, with no fade in between", () => {
    act(() => root.render(createElement(WelcomePage)));
    const resume = host.querySelector<HTMLButtonElement>('[data-testid="continue-resume"]');
    expect(resume).not.toBeNull();
    act(() => resume!.click());
    const key = communityKey(show as never);
    expect(key).toBeTruthy();
    const href = libraryIntentHref({ resume: key! });
    expect(href).toMatch(/^\/library\?resume=/);
    // Synchronously: a 500 ms fade would spend the tap's activation.
    expect(push).toHaveBeenCalledWith(href);
    expect(localStorage.getItem("hd-visited")).toBe("1");
  });

  it("a returning visitor is sent to the Library, where the card is at the top; it is not drawn here", () => {
    localStorage.setItem("hd-visited", "1");
    act(() => root.render(createElement(WelcomePage)));
    expect(host.querySelector('[data-testid="continue-resume"]')).toBeNull();
  });
});
