import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * useTextScalePreference, extracted from DesktopShell (HD-018).
 *
 * The preference is written in three places — the CSS variable every
 * `text-hd-*` step multiplies by, the localStorage mirror the pre-paint script
 * in app/layout.tsx reads, and Dexie, the durable copy — and read back through
 * useTextScale(). Runs against the real Dexie on fake-indexeddb, so "persisted"
 * means a fresh read of the database finds it.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { useTextScalePreference } = await import("@/hooks/useTextScalePreference");
const { db, getPreference, setPreference } = await import("@/db");

type Api = ReturnType<typeof useTextScalePreference>;
let api: Api;
const capture = (a: Api) => { api = a; };
function Probe({ onApi }: { onApi: (a: Api) => void }) {
  onApi(useTextScalePreference());
  return null;
}

let root: Root;
let container: HTMLDivElement;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { onApi: capture }));
  });
  // Let the Dexie read issued at mount resolve and apply.
  await act(async () => {
    await getPreference("text-scale");
  });
}

const cssScale = () =>
  document.documentElement.style.getPropertyValue("--hd-text-scale");

beforeEach(async () => {
  await db.userPrefs.clear();
  localStorage.clear();
  document.documentElement.style.removeProperty("--hd-text-scale");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useTextScalePreference", () => {
  it("applies the stored preference at mount, and reports it", async () => {
    await setPreference("text-scale", "1.3");
    await mount();
    await vi.waitFor(() => expect(cssScale()).toBe("1.3"));
    expect(localStorage.getItem("hd-text-scale")).toBe("1.3");
    expect(api.textScale).toBe("1.3");
  });

  it("applies, mirrors and persists a new choice", async () => {
    await mount();
    expect(api.textScale).toBe("1");
    await act(async () => {
      await api.setTextScale("1.15");
    });
    expect(cssScale()).toBe("1.15");
    expect(localStorage.getItem("hd-text-scale")).toBe("1.15");
    expect(api.textScale).toBe("1.15");
    expect(await getPreference("text-scale")).toBe("1.15");
  });

  it("cycles Normal → Large → Extra Large → Normal", async () => {
    await mount();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        api.cycleTextScale();
      });
      await vi.waitFor(async () => {
        expect(await getPreference("text-scale")).toBe(api.textScale);
      });
      seen.push(api.textScale);
    }
    expect(seen).toEqual(["1.15", "1.3", "1"]);
  });
});
