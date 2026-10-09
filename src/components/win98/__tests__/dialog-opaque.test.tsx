import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "@/components/win98/Dialog";
import { Window } from "@/components/win98/Window";

/**
 * A dialog's body is opaque (2026-10-01): `glass-heavy` is 72% opaque and
 * leans on a backdrop blur, and where the blur did not render, the studio's
 * text read through "Transmission Interrupted". Windows in the page keep the
 * glass. The browser half is e2e/phone-chrome.spec.ts.
 */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(node: React.ReactNode): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const classesOf = (el: Element | null) => (el?.className ?? "").split(/\s+/);

describe("Dialog surface", () => {
  it("a dialog's window has the solid surface and no glass", () => {
    const h = render(
      <Dialog open onClose={() => {}} title="Transmission Interrupted" urgent>
        <p>This broadcast isn&apos;t coming through.</p>
      </Dialog>,
    );
    const win = h.querySelector('[role="alertdialog"] > div');
    expect(classesOf(win)).toContain("bg-raised-surface");
    expect(classesOf(win)).not.toContain("glass-heavy");
  });

  it("control: a window in the page keeps its glass", () => {
    const h = render(
      <Window title="On Air">
        <p>x</p>
      </Window>,
    );
    expect(classesOf(h.firstElementChild)).toContain("glass-heavy");
  });
});
