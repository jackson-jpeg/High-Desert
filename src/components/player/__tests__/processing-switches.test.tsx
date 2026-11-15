import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The Level and Clean up switches (ProcessingSwitches): they read the store
 * and call the processing module, greyed with the reason when this device
 * cannot run them. The copy is user-facing, so it is held to no em dashes.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const calls: string[] = [];
vi.mock("@/audio/processing", async () => {
  const { useProcessingStore } = await import("@/stores/processing-store");
  return {
    setLevelSwitch: (on: boolean) => {
      calls.push(`level:${on}`);
      useProcessingStore.getState().setLevel(on);
    },
    setCleanupSwitch: (on: boolean) => {
      calls.push(`cleanup:${on}`);
      useProcessingStore.getState().setCleanup(on);
    },
  };
});

const { useProcessingStore, UNAVAILABLE_REASON } = await import("@/stores/processing-store");
const { ProcessingSwitches, LEVEL_EXPLAINER, CLEANUP_EXPLAINER, STRIP_DEFAULT, STRIP_LEVEL_ONLY } = await import("@/components/player/ProcessingSwitches");

let root: Root;
let el: HTMLDivElement;

function mount(props: { look: "win98" | "night"; layout: "rows" | "strip" }) {
  act(() => root.render(createElement(ProcessingSwitches, props)));
}
const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement;

beforeEach(() => {
  calls.length = 0;
  localStorage.clear();
  useProcessingStore.setState({ level: true, cleanup: false, cleanupOffered: true, availability: "ok", hydrated: true });
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

describe("ProcessingSwitches", () => {
  it("shows each switch's state and flips it through the processing module", () => {
    mount({ look: "night", layout: "rows" });
    expect(q("dsp-level").getAttribute("aria-checked")).toBe("true");
    expect(q("dsp-cleanup").getAttribute("aria-checked")).toBe("false");
    act(() => q("dsp-cleanup").click());
    act(() => q("dsp-level").click());
    expect(calls).toEqual(["cleanup:true", "level:false"]);
    expect(q("dsp-level").getAttribute("aria-checked")).toBe("false");
    expect(q("dsp-cleanup").getAttribute("aria-checked")).toBe("true");
    expect(q("dsp-cleanup").classList.contains("hd-dsp-switch-on")).toBe(true);
  });

  it("rows: each switch is described by its own line", () => {
    mount({ look: "win98", layout: "rows" });
    const desc = (id: string) => document.getElementById(q(id).getAttribute("aria-describedby")!)!.textContent;
    expect(desc("dsp-level")).toBe(LEVEL_EXPLAINER);
    expect(desc("dsp-cleanup")).toBe(CLEANUP_EXPLAINER);
    expect(q("dsp-level").textContent).toContain("LEVEL");
  });

  it("strip: the line names the switch under the pointer or focus", () => {
    mount({ look: "win98", layout: "strip" });
    expect(q("dsp-line").textContent).toBe(STRIP_DEFAULT);
    act(() => q("dsp-cleanup").focus());
    expect(q("dsp-line").textContent).toBe(CLEANUP_EXPLAINER);
    act(() => q("dsp-cleanup").blur());
    expect(q("dsp-line").textContent).toBe(STRIP_DEFAULT);
  });

  it("greys both switches with the reason when the device cannot run them, and ignores taps", () => {
    useProcessingStore.setState({ availability: "ios" });
    mount({ look: "night", layout: "rows" });
    for (const id of ["dsp-level", "dsp-cleanup"]) {
      expect(q(id).getAttribute("aria-disabled")).toBe("true");
      expect(q(id).getAttribute("aria-checked")).toBe("false");
    }
    expect(q("dsp-reason").textContent).toBe(UNAVAILABLE_REASON.ios);
    act(() => q("dsp-level").click());
    expect(calls).toEqual([]);
  });

  it("goes grey the moment the processor fails mid-show", () => {
    mount({ look: "win98", layout: "strip" });
    act(() => useProcessingStore.getState().setAvailability("failed"));
    expect(q("dsp-line").textContent).toBe(UNAVAILABLE_REASON.failed);
    expect(q("dsp-level").getAttribute("aria-disabled")).toBe("true");
  });

  it("Clean up held back: only Level is drawn, and the strip explains Level alone", () => {
    useProcessingStore.setState({ cleanupOffered: false });
    for (const layout of ["rows", "strip"] as const) {
      mount({ look: "win98", layout });
      expect(q("dsp-cleanup")).toBeNull();
      expect(q("dsp-level")).not.toBeNull();
      if (layout === "strip") expect(q("dsp-line").textContent).toBe(STRIP_LEVEL_ONLY);
      act(() => root.unmount());
      root = createRoot(el);
    }
  });

  it("no em dash in any copy", () => {
    for (const s of [LEVEL_EXPLAINER, CLEANUP_EXPLAINER, STRIP_DEFAULT, STRIP_LEVEL_ONLY]) expect(s).not.toMatch(/—/);
    for (const look of ["win98", "night"] as const)
      for (const layout of ["rows", "strip"] as const) {
        mount({ look, layout });
        expect(el.textContent).not.toMatch(/—/);
      }
  });
});
