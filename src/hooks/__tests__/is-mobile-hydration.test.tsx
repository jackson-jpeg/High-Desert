import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { useIsMobile } from "@/hooks/useMediaQuery";

/**
 * HD-037: what `useIsMobile()` answers on the server and through hydration.
 * React renders the hydration pass from the *server* snapshot, so whatever
 * that is, every visitor's first client render gets it too. It used to be
 * "mobile" — the query is `min-width: 768px` and its server snapshot was a
 * fixed `false` — so a desktop visit rendered the mobile tree first.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const seen: string[] = [];
function Probe() {
  const layout = useIsMobile() ? "mobile" : "desktop";
  seen.push(layout);
  return <div data-layout={layout}>{layout}</div>;
}

function viewport(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 768px)" ? wide : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** Server-render, then hydrate on a client with the given viewport. */
async function hydrateOn(wide: boolean) {
  const html = renderToString(<Probe />);
  seen.length = 0;
  viewport(wide);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const recoverable: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, <Probe />, { onRecoverableError: (e) => recoverable.push(e) });
  });
  const result = { html, text: container.textContent, errors: [...errors.mock.calls], recoverable };
  errors.mockRestore();
  await act(async () => root.unmount());
  container.remove();
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
  seen.length = 0;
});

describe("useIsMobile — server snapshot (HD-037)", () => {
  it("the server renders the desktop layout", () => {
    expect(renderToString(<Probe />)).toContain('data-layout="desktop"');
  });

  it("a desktop visit never renders the mobile layout, not even for the hydration pass", async () => {
    const r = await hydrateOn(true);
    expect(seen).not.toContain("mobile");
    expect(r.text).toBe("desktop");
    expect(r.recoverable).toEqual([]);
  });

  it("a phone hydrates without a mismatch, then switches to mobile", async () => {
    const r = await hydrateOn(false);
    // First the server's answer (so the markup matches), then the real one.
    expect(seen[0]).toBe("desktop");
    expect(r.text).toBe("mobile");
    expect(r.recoverable).toEqual([]);
    expect(r.errors.filter((c) => String(c[0]).includes("hydrat"))).toEqual([]);
  });
});
