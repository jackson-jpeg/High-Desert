import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * An admin who loads /search or /scanner directly (a reload, a bookmark) stays
 * there. The page's effect runs before the layout's, so it used to decide
 * before the layout's hydrate() had read the saved flag, and sent every admin
 * to /library. Win98 has no admin tabs, so a reload was the only way back.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/components/search/SearchPanel", () => ({ SearchPanel: () => createElement("p", null, "search panel") }));

const { default: SearchPage } = await import("../[look]/(desktop)/search/page");
const { useAdminStore } = await import("@/stores/admin-store");

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  replace.mockClear();
  useAdminStore.setState({ isAdmin: false });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

describe("an admin page loaded directly", () => {
  it("keeps an admin whose flag is saved, before any layout has hydrated the store", async () => {
    localStorage.setItem("hd-admin", "1");
    await act(async () => root.render(createElement(SearchPage)));
    expect(replace).not.toHaveBeenCalled();
    expect(host.textContent).toContain("search panel");
  });

  it("control: a visitor with no flag is sent to the library", async () => {
    await act(async () => root.render(createElement(SearchPage)));
    expect(replace).toHaveBeenCalledWith("/library");
  });
});
