import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { fakeScrollBox } from "@/test-support/scroll-box";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phone Lines - Notepad: the same chat as LiveChat (useLiveChat is the one
 * stream), drawn as a plain-text log. A call is its own block (name, place,
 * line and time, then the message); tune-ins are one quiet line and a run of
 * them folds into one; the archive is a framed block; your own calls are
 * tinted; scrolled up, new calls wait behind "New calls below". Report and
 * the admin's actions are on a call's right-click menu and in Edit.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const at = (h: number, m: number, sec = 0) => new Date(2026, 9, 12, h, m, sec).toISOString();
const report = vi.fn(async () => true);
const admin = vi.fn(async () => ({ ok: true }));
let you: { name: string; line: string; admin: boolean; place: string | null; firstCall: boolean };
type Msg = { id: number; at: string; name: string; place: string | null; line: string; body: string };
type Notice = { at: string; count: number; places: string[] };
type Moment = { id: number; at: string; text: string; form: string; speaker: string | null; episode: { airDate: string; title: string } | null; reason: string };
let messages: Msg[];
let mine: number[];
let notices: Notice[];
let archive: Moment[];

vi.mock("@/hooks/useLiveChat", () => ({
  useLiveChat: () => ({
    status: "live",
    you,
    slowMode: null,
    messages,
    mine,
    reported: [],
    notices,
    archive,
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
  messages = [
    { id: 1, at: at(22, 42), name: "Skeptic", place: "Reno", line: "Line 3", body: "message" },
    { id: 2, at: at(22, 43), name: "Caller 7", place: null, line: "Line 7", body: "mine" },
  ];
  mine = [2];
  notices = [{ at: at(22, 44), count: 1, places: ["Ohio"] }];
  archive = [{ id: 9, at: at(22, 45), text: "Art signs on.", form: "description", speaker: null, episode: null, reason: "this-date" }];
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

  it("writes each call as its own block: the head, then the message on its own line", () => {
    mount();
    const first = all("live-message")[0];
    const head = first.querySelector<HTMLElement>('[data-testid="call-head"]')!;
    const body = first.querySelector<HTMLElement>('[data-testid="message-body"]')!;
    expect(head.textContent!.replace(/\u00A0/g, " ")).toBe("Skeptic, calling from Reno \u00B7 Line 3 [10:42 PM]");
    expect(body.textContent).toBe("message");
    // Two elements, the message after the head: not one run-on line.
    expect(head.contains(body)).toBe(false);
    expect(head.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The name is the bold part; the place and line the quieter part; the time the dimmest.
    expect(head.querySelector('[data-testid="caller-name"]')!.className).toContain("hd-w98-notepad-name");
    expect(head.querySelector('[data-testid="caller-place"]')!.closest(".hd-w98-notepad-meta")).not.toBeNull();
    expect(head.querySelector('[data-testid="call-time"]')!.className).toContain("hd-w98-notepad-time");
  });

  it("keeps the time out of the part that wraps, so it stays on the first line (2026-10-13)", () => {
    mount();
    const head = all("live-message")[0].querySelector<HTMLElement>('[data-testid="call-head"]')!;
    const who = head.querySelector<HTMLElement>('[data-testid="call-who"]')!;
    const time = head.querySelector<HTMLElement>('[data-testid="call-time"]')!;
    // The name and its meta wrap inside `who`; the time is its own part after
    // it, which the stylesheet holds on the first line.
    expect(who.contains(head.querySelector('[data-testid="caller-name"]'))).toBe(true);
    expect(who.contains(head.querySelector('[data-testid="line-label"]'))).toBe(true);
    expect(who.contains(time)).toBe(false);
    expect(who.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Control: the time is still inside the head, not pushed below the message.
    expect(head.contains(time)).toBe(true);
  });

  it("names a call's parts the way LiveChat does, so one spec reads both looks", () => {
    mount();
    const first = all("live-message")[0];
    const part = (id: string) => first.querySelector(`[data-testid="${id}"]`)?.textContent;
    expect(part("line-label")).toBe("Line 3");
    expect(part("caller-name")).toBe("Skeptic");
    expect(part("caller-place")).toBe(", calling from Reno");
    expect(part("message-body")).toBe("message");
  });

  it("tints the caller's own call, and only that one", () => {
    mount();
    const [theirs, own] = all("live-message");
    expect(own.dataset.mine).toBe("true");
    expect(theirs.dataset.mine).toBeUndefined();
  });

  it("writes a tune-in as one quiet line, and folds a run of them into one", () => {
    mount();
    expect(all("tunein-notice")).toHaveLength(1);
    expect(all("tunein-notice")[0].textContent).toBe("[10:44 PM] *** A listener just tuned in from Ohio ***");
    expect(all("tunein-notice")[0].className).toContain("hd-w98-notepad-tunein");

    notices = [
      { at: at(22, 44), count: 1, places: [] },
      { at: at(22, 44, 20), count: 1, places: [] },
      { at: at(22, 44, 40), count: 1, places: [] },
    ];
    mount();
    expect(all("tunein-notice")).toHaveLength(1);
    expect(all("tunein-notice")[0].textContent).toContain("3 new listeners tuned in");
    expect(all("tunein-notice")[0].dataset.merged).toBe("3");
  });

  it("keeps tune-ins apart when a call comes between them (control)", () => {
    notices = [
      { at: at(22, 41), count: 1, places: [] },
      { at: at(22, 44), count: 1, places: [] },
    ];
    mount();
    expect(all("tunein-notice")).toHaveLength(2);
  });

  it("draws an archive moment as its own framed block, labelled, with the show's link inside it", () => {
    archive = [{ ...archive[0], episode: { airDate: "1997-03-13", title: "Area 51 caller" } }];
    mount();
    const block = all("archive-line")[0];
    expect(block.className).toContain("hd-w98-notepad-archive");
    expect(block.querySelector('[data-testid="archive-label"]')!.textContent).toBe(">>> From the archive");
    expect(block.querySelector('[data-testid="archive-text"]')!.textContent).toBe("Art signs on.");
    expect(block.querySelector('[data-testid="archive-episode"]')).not.toBeNull();
    // Never a call: no caller name, no line.
    expect(block.querySelector('[data-testid="caller-name"]')).toBeNull();
  });

  it("sets the place and line in italics, the name not (2026-10-13)", () => {
    // jsdom computes no stylesheet, so read the rule the class is drawn by.
    const css = readFileSync(join(process.cwd(), "src/styles/look-win98.css"), "utf8");
    const rule = (sel: string) => css.match(new RegExp(`html\\[data-look="win98"\\] ${sel.replace(".", "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule(".hd-w98-notepad-meta")).toMatch(/font-style:\s*italic/);
    expect(rule(".hd-w98-notepad-name")).not.toMatch(/italic/);
    mount();
    const head = all("call-head")[0];
    const meta = head.querySelector(".hd-w98-notepad-meta")!;
    expect(meta.querySelector('[data-testid="line-label"]')).not.toBeNull();
    expect(meta.querySelector('[data-testid="caller-name"]')).toBeNull();
  });

  it("heads a station notice From the station, with no show link (2026-10-13)", () => {
    archive = [{ ...archive[0], reason: "station", text: "Sorry for tonight's hiccups." }];
    mount();
    const block = all("archive-line")[0];
    expect(block.querySelector('[data-testid="archive-label"]')!.textContent).toBe(">>> From the station");
    expect(block.querySelector('[data-testid="archive-episode"]')).toBeNull();
  });

  describe("scrolled up, new calls wait behind a button", () => {
    const add = (id: number, name = "Desert Rat") => {
      messages = [...messages, { id, at: at(22, 50), name, place: null, line: "Line 2", body: `call ${id}` }];
    };

    it("does not move the reader, and offers New calls below", () => {
      mount();
      const box = fakeScrollBox(one("live-messages")!);
      box.scrollUp();
      expect(one("new-calls")).toBeNull();
      box.grow(80);
      add(3);
      mount();
      expect(box.top).toBe(0);
      expect(one("new-calls")!.textContent).toContain("New calls below");
      act(() => one("new-calls")!.click());
      expect(box.top).toBe(box.bottom);
      expect(one("new-calls")).toBeNull();
    });

    it("follows new calls at the bottom (control), with no button", () => {
      mount();
      const box = fakeScrollBox(one("live-messages")!);
      box.scrollToBottom();
      box.grow(80);
      add(3);
      mount();
      expect(box.top).toBe(box.bottom);
      expect(one("new-calls")).toBeNull();
    });

    it("a tune-in never raises it", () => {
      mount();
      const box = fakeScrollBox(one("live-messages")!);
      box.scrollUp();
      notices = [...notices, { at: at(22, 55), count: 1, places: [] }];
      mount();
      expect(one("new-calls")).toBeNull();
    });

    it("takes the caller down to their own call", () => {
      mount();
      const box = fakeScrollBox(one("live-messages")!);
      box.scrollUp();
      box.grow(80);
      add(3, "Caller 7");
      mine = [2, 3];
      mount();
      expect(box.top).toBe(box.bottom);
      expect(one("new-calls")).toBeNull();
    });
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
