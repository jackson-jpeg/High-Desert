import { describe, it, expect, beforeEach } from "vitest";
import { useContextMenuStore } from "../context-menu-store";

const s = () => useContextMenuStore.getState();

beforeEach(() => {
  useContextMenuStore.setState({ open: false, position: { x: 0, y: 0 }, items: [] });
});

describe("the Win98 context menu", () => {
  it("opens at the coordinates it was given, with the items it was given", () => {
    const items = [{ label: "Play", onClick: () => {} }];
    s().show(120, 340, items);

    expect(s().open).toBe(true);
    expect(s().position).toEqual({ x: 120, y: 340 });
    expect(s().items).toBe(items);
  });

  it("re-opening somewhere else replaces both the position and the items", () => {
    // Right-clicking one row and then another must not leave the first row's
    // actions on the menu — they close over the wrong episode.
    s().show(10, 10, [{ label: "Play A", onClick: () => {} }]);
    s().show(90, 90, [{ label: "Play B", onClick: () => {} }]);

    expect(s().position).toEqual({ x: 90, y: 90 });
    expect(s().items.map((i) => i.label)).toEqual(["Play B"]);
  });

  it("opens at the origin without treating it as unset", () => {
    // A right-click in the very top-left corner is a real position, and 0,0 is
    // the same value the store initialises to.
    s().show(0, 0, []);
    expect(s().open).toBe(true);
    expect(s().position).toEqual({ x: 0, y: 0 });
  });

  it("hide closes it", () => {
    s().show(5, 5, [{ label: "Play", onClick: () => {} }]);
    s().hide();
    expect(s().open).toBe(false);
  });

  it("hide leaves the items in place, and that is fine because open gates the render", () => {
    // Documented rather than changed: clearing them here would unmount the menu
    // mid-close-animation. Nothing reads `items` unless `open` is true.
    s().show(5, 5, [{ label: "Play", onClick: () => {} }]);
    s().hide();
    expect(s().items).toHaveLength(1);
    expect(s().open).toBe(false);
  });
});
