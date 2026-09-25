import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/utils/safe-storage";
import { BOOT_SCRIPT } from "@/app/boot-script";

/**
 * HD-040: Web Storage writes cannot throw into the app. `setItem` throws
 * QuotaExceededError when the origin is full (the OPFS audio cache shares the
 * quota), and touching `localStorage` at all throws SecurityError where storage
 * is blocked. Every write in src/ goes through `safe-storage.ts`; the boot
 * script, which runs before any module, guards its own.
 */

const SRC = path.resolve(import.meta.dirname, "../..");
const ALLOWED = new Set([
  path.join(SRC, "lib/utils/safe-storage.ts"),
  // A string executed before React; its storage calls are wrapped in-script
  // and exercised below.
  path.join(SRC, "app/boot-script.ts"),
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : walk(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("storage writes", () => {
  it("no bare localStorage/sessionStorage setItem or removeItem outside safe-storage.ts", () => {
    const bare = walk(SRC)
      .filter((f) => !ALLOWED.has(f))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => ({ line, at: `${path.relative(SRC, f)}:${i + 1}` }))
          .filter(({ line }) => /\b(local|session)Storage\s*\.\s*(setItem|removeItem)\s*\(/.test(line)),
      )
      .map(({ at }) => at);
    expect(bare, "use safeSetItem/safeRemoveItem from @/lib/utils/safe-storage").toEqual([]);
  });

  describe("safe-storage", () => {
    afterEach(() => vi.restoreAllMocks());

    it("a full origin (QuotaExceededError) is a false, not a throw", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
      expect(safeSetItem("local", "k", "v")).toBe(false);
      expect(safeSetItem("session", "k", "v")).toBe(false);
    });

    it("blocked storage (the getter itself throws) is a false/null, not a throw", () => {
      vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
      expect(safeSetItem("local", "k", "v")).toBe(false);
      expect(safeRemoveItem("local", "k")).toBe(false);
      expect(safeGetItem("local", "k")).toBeNull();
    });

    it("writes when it can", () => {
      expect(safeSetItem("local", "hd-test", "1")).toBe(true);
      expect(safeGetItem("local", "hd-test")).toBe("1");
      expect(safeRemoveItem("local", "hd-test")).toBe(true);
      expect(localStorage.getItem("hd-test")).toBeNull();
    });
  });

  describe("boot script with storage blocked", () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
      document.body.innerHTML = "";
    });

    it("still dismisses the boot screen — a throw used to abort the script before the dismissal was installed", () => {
      vi.useFakeTimers();
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
      document.body.innerHTML = `
        <div id="app-loading">
          <div id="boot-container" style="display:none"><div data-boot="0"></div></div>
          <div id="quick-splash" style="display:none"></div>
        </div>`;
      const el = document.getElementById("app-loading") as HTMLElement;

      expect(() => new Function(BOOT_SCRIPT)()).not.toThrow();
      vi.advanceTimersByTime(6000);
      expect(el.style.opacity).toBe("0");
      expect(el.style.pointerEvents).toBe("none");
    });
  });
});
