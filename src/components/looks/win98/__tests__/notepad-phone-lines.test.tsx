import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Phone Lines - Notepad: the same chat as LiveChat (useLiveChat is the one
 * stream), drawn as a plain-text log. A call is one line; tune-ins and the
 * archive are their own lines; Report and the admin's actions are on a
 * line's right-click menu and in Edit.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const at = (h: number, m: number) => new Date(2026, 9, 12, h, m).toISOString();
const report = vi.fn(async () => true);
const admin = vi.fn(async () => ({ ok: true }));
let you: { name: string; line: string; admin: boolean; place: string | null; firstCall: boolean };

vi.mock("@/hooks/useLiveChat", () => ({
  useLiveChat: () => ({
    status: "live",
    you,
    slowMode: null,
    messages: [
      { id: 1, at: at(22, 42), name: "Skeptic", place: "Reno", line: "Line 3", body: "message" },
      { id: 2, at: at(22, 43), name: you.name, place: null, line: you.line, body: "mine" },
    ],
    mine: [2],
    reported: [],
    notices: [{ at: at(22, 44), count: 1, places: ["Ohio"] }],
    archive: [{ id: 9, at: at(22, 45), text: "Art signs on.", form: "description", speaker: null, episode: null, reason: "this-date" }],
    send: vi.fn(async () => ({ ok: true })),
    rename: vi.fn(async () => ({ ok: true })),
    setPlace: vi.fn(async () => ({ ok: true })),
    report,
    admin,
  }),
}));
vi.mock("@/hooks/useCommunityNow", () => ({ useCommunityNow: () => ({ online: 5, listening: 2, live: 4, poll: 0 }) }));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => false, useMediaQuery: () => false }));
vi.mock("@/hooks/useOpenLibraryIntent", () => ({ useOpenLibraryIntent: () => vi.fn() }));

const { NotepadPhoneLines } = await import("../NotepadPhoneLines");
const { useContextMenuStore } = await import("@/stores/context-menu-store");

let root: Root;
let container: HTMLDivElement;
const all = (id: string) => [...container.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const one = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function mount(onClose?: () => void) {
  act(() => root.render(createElement(NotepadPhoneLines, { onClose })));
}

beforeEach(() => {
  you = { name: "Caller 7", line: "Line 7", admin: false, place: null, firstCall: false };
  report.mockClear();
  admin.mockClear();
  useContextMenuStore.setState({ open: false, items: [] });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Phone Lines - Notepad", () => {
  it("is titled as Notepad, with its four menus", () => {
    mount();
    expect(container.textContent).toContain("Phone Lines - Notepad");
    for (const m of ["file", "edit", "format", "help"]) expect(one(`notepad-menu-${m}`)).not.toBeNull();
  });

  it("writes each call as one log line, and tune-ins and the archive as their own", () => {
    mount();
    const calls = all("live-message").map((l) => l.textContent);
    expect(calls[0]).toBe("[10:42 PM] Line 3, Skeptic from Reno: message");
    expect(all("tunein-notice")[0].textContent).toMatch(/^\[10:44 PM\] \*\*\* .+ \*\*\*$/);
    expect(all("archive-line")[0].textContent).toBe("[10:45 PM] >>> From the archive: Art signs on.");
  });

  it("offers Report on someone else's call by right-click, and sends it", () => {
    mount();
    act(() => {
      all("live-message")[0].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    });
    const items = useContextMenuStore.getState().items;
    const item = items.find((i) => i.label.startsWith("Report"));
    expect(item).toBeDefined();
    act(() => item!.onClick());
    expect(report).toHaveBeenCalledWith(1);
    expect(one("live-status")!.textContent).toContain("Call from Skeptic selected");
  });

  it("offers nothing to report on the caller's own call", () => {
    mount();
    act(() => {
      all("live-message")[1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(useContextMenuStore.getState().items.some((i) => i.label.startsWith("Report"))).toBe(false);
  });

  it("gives an admin the moderation actions", () => {
    you = { ...you, admin: true };
    mount();
    act(() => {
      all("live-message")[0].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    const hide = useContextMenuStore.getState().items.find((i) => i.label === "Hide call");
    act(() => hide!.onClick());
    expect(admin).toHaveBeenCalledWith("hide", { messageId: 1 });
  });

  it("hides tune-ins from the Format menu", () => {
    mount();
    expect(all("tunein-notice")).toHaveLength(1);
    act(() => one("notepad-menu-format")!.click());
    act(() => one("toggle-tuneins")!.click());
    expect(all("tunein-notice")).toHaveLength(0);
  });

  it("shows the shared live count, and Exit only when it can close", () => {
    const onClose = vi.fn();
    mount(onClose);
    expect(one("live-listeners")!.textContent).toContain("4");
    act(() => one("notepad-menu-file")!.click());
    const exit = [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.includes("Exit"));
    act(() => exit!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the call box", () => {
    mount();
    expect(one("composer")).not.toBeNull();
    expect(one("send")).not.toBeNull();
    expect(one("char-count")!.textContent).toBe("0/280");
  });
});
