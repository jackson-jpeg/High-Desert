import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The 404 and the error page dismiss the boot screen themselves.
 *
 * Both can be drawn in the browser (a notFound() on a dynamic route arrives as
 * an error shell), where the inline boot script never runs, so nothing else
 * hides #app-loading: "Signal Lost" sat under it, a blank screen.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/desktop/Starfield", () => ({ Starfield: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never),
}));

let root: Root;
let host: HTMLDivElement;
let overlay: HTMLDivElement;

beforeEach(() => {
  overlay = document.createElement("div");
  overlay.id = "app-loading";
  document.body.appendChild(overlay);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  overlay.remove();
});

async function mount(C: ComponentType<Record<string, unknown>>, props: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(createElement(C, props));
  });
}

describe("pages drawn without the boot script", () => {
  it("the 404 hides the boot screen", async () => {
    const { default: NotFound } = await import("../[look]/not-found");
    await mount(NotFound as ComponentType<Record<string, unknown>>);
    expect(host.textContent).toContain("Signal Lost");
    expect(overlay.style.display).toBe("none");
  });

  it("the error page hides the boot screen", async () => {
    const { default: SegmentError } = await import("../[look]/error");
    await mount(SegmentError as ComponentType<Record<string, unknown>>, {
      error: Object.assign(new Error("boom"), { digest: "x" }),
      reset: () => {},
    });
    expect(overlay.style.display).toBe("none");
  });

  it("control: an overlay nobody dismisses stays", () => {
    expect(overlay.style.display).toBe("");
  });
});
