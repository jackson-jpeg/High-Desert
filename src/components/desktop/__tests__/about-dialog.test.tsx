import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AboutDialog } from "../AboutDialog";

/**
 * The About dialog's Privacy paragraph (2026-10-20): what the site keeps since
 * the visitor count (docs/visitors.md), said plainly, and held to the house
 * rule on user-facing copy (no em dashes).
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("About dialog", () => {
  it("says what is kept: one random id per browser, a place looked up on our server, no address, no third party", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<AboutDialog open onClose={() => {}} isAdmin={false} episodeCount={1413} />));
    const privacy = document.querySelector('[data-testid="about-privacy"]');
    expect(privacy?.textContent?.replace(/\s+/g, " ")).toBe(
      "Privacy" +
        "Your library, favorites and history stay in this browser. To count visitors once, the site keeps one random id per browser, and our own server looks up an approximate country and state from your connection. Your address is never stored, and none of this goes to a third party.",
    );
    expect(document.body.textContent).not.toContain("—");
  });
});
