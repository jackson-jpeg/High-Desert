import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Audio Cache left /stats for the settings, in plain words (UI plan push 6,
 * batch 2): shown only when this device holds saved shows.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let size = 0;
const clearAudioCache = vi.fn(async () => {});
vi.mock("@/audio/cache", () => ({ getCacheSize: () => Promise.resolve(size), clearAudioCache: () => clearAudioCache() }));
vi.mock("@/stores/toast-store", () => ({ toast: { success: vi.fn() } }));

const { SavedAudioSetting, formatSavedBytes } = await import("../SavedAudioSetting");

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  host?.remove();
});

async function render() {
  const h = document.createElement("div");
  document.body.appendChild(h);
  const r = createRoot(h);
  host = h;
  root = r;
  await act(async () => r.render(<SavedAudioSetting variant="sheet" />));
  await act(async () => {});
  return h;
}

describe("SavedAudioSetting", () => {
  it("nothing saved: nothing drawn", async () => {
    size = 0;
    const h = await render();
    expect(h.querySelector('[data-testid="saved-audio"]')).toBeNull();
  });

  it("shows saved: the size in plain words, and Clear empties it", async () => {
    size = 1.25 * 1024 ** 3;
    const h = await render();
    const row = h.querySelector('[data-testid="saved-audio"]')!;
    expect(row.textContent).toContain("Saved on this device: 1.3 GB");
    expect(row.textContent).not.toMatch(/OPFS|cache/i);
    await act(async () => h.querySelector<HTMLButtonElement>('[data-testid="saved-audio-clear"]')!.click());
    expect(clearAudioCache).toHaveBeenCalledOnce();
    expect(h.querySelector('[data-testid="saved-audio"]')).toBeNull();
  });

  it("bytes for people", () => {
    expect(formatSavedBytes(900 * 1024)).toBe("900 KB");
    expect(formatSavedBytes(12.34 * 1024 ** 2)).toBe("12.3 MB");
  });

  it("is in the settings a device has: the More sheet and both Display dialogs", () => {
    for (const f of ["src/components/mobile/MobileMenuSheet.tsx", "src/components/looks/NightDisplay.tsx", "src/components/looks/win98/DisplayProperties.tsx"]) {
      expect(readFileSync(path.join(process.cwd(), f), "utf8")).toContain("<SavedAudioSetting");
    }
  });
});
