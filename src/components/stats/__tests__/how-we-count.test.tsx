import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HowWeCount } from "../HowWeCount";

/** The fine print behind a small "How we count" link (UI plan push 6, batch 5). */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  host?.remove();
});

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("HowWeCount", () => {
  it("is closed until asked, and the link says How we count", () => {
    const h = document.createElement("div");
    document.body.appendChild(h);
    const r = createRoot(h);
    host = h;
    root = r;
    act(() => r.render(<HowWeCount id="t"><p>the fine print</p></HowWeCount>));
    const d = h.querySelector("details")!;
    expect(d.open).toBe(false);
    expect(d.querySelector("summary")!.textContent).toBe("How we count");
    expect(d.textContent).toContain("the fine print");
  });

  it("every panel's fine print sits inside one, and the geo credit stays outside it", () => {
    const traffic = read("src/components/library/SignalTraffic.tsx");
    const t = traffic.indexOf('<HowWeCount id="traffic">');
    expect(t).toBeGreaterThan(-1);
    expect(traffic.indexOf("Plays all time includes")).toBeGreaterThan(t);
    expect(traffic.indexOf("Plays all time includes")).toBeLessThan(traffic.indexOf("</HowWeCount>"));

    const listeners = read("src/components/library/Listeners.tsx");
    const l0 = listeners.indexOf('<HowWeCount id="listeners">');
    const l1 = listeners.indexOf("</HowWeCount>");
    expect(listeners.indexOf("Each browser counts once")).toBeGreaterThan(l0);
    expect(listeners.indexOf("Each browser counts once")).toBeLessThan(l1);
    expect(listeners.indexOf("data-geo-credit")).toBeGreaterThan(l1);

    const page = read("src/app/[look]/(desktop)/stats/page.tsx");
    expect(page).toContain('<HowWeCount id="you"');
    expect(page).toContain('<HowWeCount id="archive"');
    expect(read("src/components/stats/RatingsReport.tsx")).toContain('<HowWeCount id="report">');
  });
});
