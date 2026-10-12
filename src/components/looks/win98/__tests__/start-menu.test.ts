import { describe, expect, it } from "vitest";
import {
  DIAL_HREF,
  HOLE_WORD,
  notFoundMessage,
  PHONE_LINES_HREF,
  runCommand,
  settingsItems,
  startMenuItems,
  submenuOf,
  startMenuKey,
  typeKey,
} from "../start-menu";

const labels = (o: { isAdmin: boolean; isMobile: boolean }) => startMenuItems(o).map((i) => i.label);

describe("startMenuItems", () => {
  it("lists the brief's places in order, with Shut Down last", () => {
    expect(labels({ isAdmin: false, isMobile: false })).toEqual([
      "Library",
      "Live",
      "Phone Lines",
      "Dial",
      "Stats",
      "Settings",
      "About High Desert",
      "Shortcuts",
      "Help",
      "Run...",
      "Shut Down...",
    ]);
  });

  it("never lists Radio, in any variant", () => {
    for (const isAdmin of [false, true]) {
      for (const isMobile of [false, true]) {
        for (const item of startMenuItems({ isAdmin, isMobile })) {
          expect(item.label.toLowerCase()).not.toContain("radio");
          if (item.action.kind === "route") expect(item.action.href).not.toMatch(/^\/radio/);
        }
      }
    }
  });

  it("sends Dial to the Library's dial and Phone Lines to the Live screen", () => {
    const items = startMenuItems({ isAdmin: false, isMobile: false });
    expect(items.find((i) => i.id === "dial")?.action).toEqual({ kind: "route", href: DIAL_HREF });
    expect(DIAL_HREF).toBe("/library?view=dial");
    expect(items.find((i) => i.id === "phone-lines")?.action).toEqual({ kind: "route", href: PHONE_LINES_HREF });
    expect(PHONE_LINES_HREF.startsWith("/live")).toBe(true);
  });

  it("adds Scanner and Search for an admin only", () => {
    expect(labels({ isAdmin: false, isMobile: false })).not.toContain("Scanner");
    const admin = labels({ isAdmin: true, isMobile: false });
    expect(admin).toContain("Scanner");
    expect(admin).toContain("Search archive.org");
  });

  it("Settings opens a submenu: Display everywhere, and the More sheet on a phone (it has no menu bar)", () => {
    for (const isMobile of [false, true]) {
      const settings = startMenuItems({ isAdmin: false, isMobile }).find((i) => i.id === "settings")!;
      const sub = submenuOf(settings)!;
      expect(sub).toEqual(settingsItems({ isMobile }));
      expect(sub[0]).toMatchObject({ id: "display", label: "Display...", action: { kind: "display" } });
      expect(sub.map((i) => i.action.kind)).toEqual(isMobile ? ["display", "settings"] : ["display"]);
    }
    expect(submenuOf(startMenuItems({ isAdmin: false, isMobile: false })[0])).toBeNull();
  });

  it("a submenu's accelerators are unique letters of its labels", () => {
    const sub = settingsItems({ isMobile: true });
    expect(new Set(sub.map((i) => i.accel.toLowerCase())).size).toBe(sub.length);
    for (const i of sub) expect(i.label.toLowerCase()).toContain(i.accel.toLowerCase());
  });

  it("gives every item a unique accelerator that is a letter of its label", () => {
    for (const isAdmin of [false, true]) {
      for (const isMobile of [false, true]) {
        const items = startMenuItems({ isAdmin, isMobile });
        const accels = items.map((i) => i.accel.toLowerCase());
        expect(new Set(accels).size).toBe(accels.length);
        for (const i of items) expect(i.label.toLowerCase()).toContain(i.accel.toLowerCase());
      }
    }
  });

  it("uses no em dash in any label", () => {
    for (const i of startMenuItems({ isAdmin: true, isMobile: true })) expect(i.label).not.toContain("—");
  });
});

describe("startMenuKey", () => {
  const items = startMenuItems({ isAdmin: false, isMobile: false });
  const last = items.length - 1;

  it("moves with the arrows and wraps at both ends", () => {
    expect(startMenuKey("ArrowDown", 0, items)).toBe(1);
    expect(startMenuKey("ArrowDown", last, items)).toBe(0);
    expect(startMenuKey("ArrowUp", 0, items)).toBe(last);
    expect(startMenuKey("ArrowUp", 3, items)).toBe(2);
  });

  it("starts from nothing focused", () => {
    expect(startMenuKey("ArrowDown", -1, items)).toBe(0);
    expect(startMenuKey("ArrowUp", -1, items)).toBe(last);
  });

  it("jumps to the ends with Home and End", () => {
    expect(startMenuKey("Home", 4, items)).toBe(0);
    expect(startMenuKey("End", 0, items)).toBe(last);
  });

  it("jumps to the item a letter underlines, either case", () => {
    expect(items[startMenuKey("d", 0, items)!].id).toBe("dial");
    expect(items[startMenuKey("U", 0, items)!].id).toBe("shutdown");
  });

  it("leaves other keys alone", () => {
    expect(startMenuKey("z", 0, items)).toBeNull();
    expect(startMenuKey("Tab", 0, items)).toBeNull();
    expect(startMenuKey("ArrowDown", 0, [])).toBeNull();
  });
});

describe("runCommand", () => {
  it("opens Mel's Hole by any of its names, whatever the spacing or case", () => {
    for (const name of ["melshole", "Mel's Hole", "MELS_HOLE.EXE", " mel waters ", "Ellensburg"]) {
      expect(runCommand(name)).toEqual({ kind: "mels-hole" });
    }
  });

  it("routes the program names", () => {
    expect(runCommand("notepad")).toEqual({ kind: "action", action: { kind: "route", href: PHONE_LINES_HREF } });
    expect(runCommand("radio.exe")).toEqual({ kind: "action", action: { kind: "route", href: DIAL_HREF } });
    expect(runCommand("taskmgr")).toEqual({ kind: "action", action: { kind: "route", href: "/stats" } });
    expect(runCommand("winver")).toEqual({ kind: "action", action: { kind: "about" } });
    expect(runCommand("desk.cpl")).toEqual({ kind: "action", action: { kind: "display" } });
    expect(runCommand("Display")).toEqual({ kind: "action", action: { kind: "display" } });
  });

  it("refuses the unknown, by the name as typed", () => {
    expect(runCommand("  doom.exe ")).toEqual({ kind: "not-found", name: "doom.exe" });
    expect(runCommand("   ")).toEqual({ kind: "empty" });
    const msg = notFoundMessage("doom.exe");
    expect(msg).toContain("'doom.exe'");
    expect(msg).not.toContain("—");
  });
});

describe("typeKey", () => {
  const feed = (keys: string) => {
    let p = 0;
    let done = false;
    for (const k of keys) {
      const r = typeKey(p, k);
      p = r.progress;
      done = r.done;
    }
    return done;
  };

  it("completes on the word and only on it", () => {
    expect(HOLE_WORD).toBe("hole");
    expect(feed("hole")).toBe(true);
    expect(feed("HOLE")).toBe(true);
    expect(feed("hol")).toBe(false);
    expect(feed("hoxle")).toBe(false);
  });

  it("restarts on the first letter after a wrong key", () => {
    expect(feed("hhole")).toBe(true);
    expect(feed("hohole")).toBe(true);
  });

  it("uses no letter the player owns (M, N, P)", () => {
    for (const k of ["m", "n", "p"]) expect(HOLE_WORD).not.toContain(k);
  });
});
