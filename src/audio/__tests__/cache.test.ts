import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The OPFS audio cache shares one quota with the listener's library (HD-010).
 *
 * jsdom has no OPFS, so this stands up a small in-memory one with the same
 * shape — directory handles, file handles, writable streams that commit on
 * `close()` and discard on `abort()` — and an `estimate()` that reports what
 * is actually stored in it. Usage is *derived from the fake's contents*, not
 * scripted per call: a quota check that ignored the previous write would then
 * see the space that write took, which is the property under test.
 */

const toastInfo = vi.fn();
vi.mock("@/stores/toast-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: (m: string) => toastInfo(m), caller: vi.fn() },
}));

interface FakeFile { data: Blob }

class FakeOPFS {
  files = new Map<string, FakeFile>();
  baseUsage = 0;
  quota = 1_000;
  active = 0;
  maxActive = 0;
  order: string[] = [];
  /** When set, every write waits on this before storing. */
  gate: Promise<void> | null = null;
  failNextWrite = false;

  usage(): number {
    let n = this.baseUsage;
    for (const f of this.files.values()) n += f.data.size;
    return n;
  }

  dir(): FileSystemDirectoryHandle {
    return {
      kind: "directory",
      getFileHandle: async (name: string, opts?: { create?: boolean }) => {
        if (!this.files.has(name)) {
          if (!opts?.create) throw new DOMException("missing", "NotFoundError");
          this.files.set(name, { data: new Blob([]) });
        }
        return this.fileHandle(name);
      },
      removeEntry: async (name: string) => {
        if (!this.files.delete(name)) throw new DOMException("missing", "NotFoundError");
      },
    } as unknown as FileSystemDirectoryHandle;
  }

  fileHandle(name: string): FileSystemFileHandle {
    return {
      kind: "file",
      getFile: async () => this.files.get(name)!.data,
      createWritable: async () => {
        let pending: Blob | null = null;
        return {
          write: async (blob: Blob) => {
            this.active++;
            this.maxActive = Math.max(this.maxActive, this.active);
            this.order.push(`start:${name}`);
            try {
              if (this.gate) await this.gate;
              if (this.failNextWrite) {
                this.failNextWrite = false;
                throw new DOMException("disk full", "QuotaExceededError");
              }
              pending = blob;
            } finally {
              this.active--;
              this.order.push(`end:${name}`);
            }
          },
          close: async () => {
            if (pending) this.files.set(name, { data: pending });
          },
          abort: async () => {
            pending = null;
          },
        };
      },
    } as unknown as FileSystemFileHandle;
  }
}

let fs: FakeOPFS;

function install(storage: Partial<StorageManager> & Record<string, unknown>) {
  Object.defineProperty(navigator, "storage", { value: storage, configurable: true });
}

function fullStorage() {
  const root = {
    getDirectoryHandle: async () => fs.dir(),
    removeEntry: async () => { fs.files.clear(); },
  };
  return {
    getDirectory: async () => root,
    estimate: async () => ({ usage: fs.usage(), quota: fs.quota }),
  };
}

const bytes = (n: number) => new Blob([new Uint8Array(n)]);

async function load() {
  vi.resetModules();
  return import("../cache");
}

beforeEach(() => {
  fs = new FakeOPFS();
  toastInfo.mockClear();
  install(fullStorage() as never);
});

describe("cacheAudioBlob — serialized", () => {
  it("runs concurrent writes one at a time, in call order", async () => {
    const { cacheAudioBlob } = await load();
    let open!: () => void;
    fs.gate = new Promise<void>((r) => (open = r));

    const writes = ["a", "b", "c"].map((k) => cacheAudioBlob(k, bytes(10)));
    await new Promise((r) => setTimeout(r, 10));
    // Only the first has reached the disk; the others are queued behind it.
    expect(fs.active).toBe(1);
    open();

    expect(await Promise.all(writes)).toEqual(["written", "written", "written"]);
    expect(fs.maxActive).toBe(1);
    expect(fs.order).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
    expect([...fs.files.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("checks each write's room AFTER the previous write landed — so a burst cannot overrun the quota together", async () => {
    const { cacheAudioBlob } = await load();
    fs.quota = 100; // ceiling 80 bytes at 0.8
    const results = await Promise.all([
      cacheAudioBlob("first", bytes(60)),
      cacheAudioBlob("second", bytes(60)),
    ]);
    expect(results).toEqual(["written", "over-quota"]);
    // What survived is exactly the first, whole.
    expect([...fs.files.keys()]).toEqual(["first"]);
    expect(fs.files.get("first")!.data.size).toBe(60);
    expect(fs.usage()).toBeLessThanOrEqual(80);
  });

  it("a failed write does not stall the queue behind it", async () => {
    const { cacheAudioBlob } = await load();
    fs.failNextWrite = true;
    const [a, b] = await Promise.all([cacheAudioBlob("a", bytes(5)), cacheAudioBlob("b", bytes(5))]);
    expect(a).toBe("failed");
    expect(b).toBe("written");
  });
});

describe("cacheAudioBlob — quota", () => {
  it("refuses a write that would cross CACHE_QUOTA_FRACTION, leaves nothing behind, and says so once", async () => {
    const { cacheAudioBlob, CACHE_QUOTA_FRACTION } = await load();
    expect(CACHE_QUOTA_FRACTION).toBe(0.8);
    fs.quota = 1_000;
    fs.baseUsage = 700; // the library, say
    await expect(cacheAudioBlob("big", bytes(200))).resolves.toBe("over-quota");
    await expect(cacheAudioBlob("big2", bytes(150))).resolves.toBe("over-quota");

    expect(fs.files.size).toBe(0); // not even an empty entry
    expect(fs.usage()).toBe(700);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo.mock.calls[0][0]).toMatch(/nearly full/i);
  });

  it("accepts a write that fits under the fraction", async () => {
    const { cacheAudioBlob } = await load();
    fs.baseUsage = 700;
    await expect(cacheAudioBlob("fits", bytes(100))).resolves.toBe("written");
    expect(fs.files.get("fits")!.data.size).toBe(100);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it("a write that fails midway removes its entry — no truncated file to serve later — and does not reject", async () => {
    const { cacheAudioBlob, getCachedAudio, hasCachedAudio } = await load();
    await cacheAudioBlob("kept", bytes(20));
    fs.failNextWrite = true;
    await expect(cacheAudioBlob("broken", bytes(20))).resolves.toBe("failed");

    expect(fs.files.has("broken")).toBe(false);
    expect(await hasCachedAudio("broken")).toBe(false);
    // The earlier entry is untouched.
    expect((await getCachedAudio("kept"))?.size).toBe(20);
  });
});

describe("cacheAudioBlob — estimate() unavailable (documented: refuse)", () => {
  it("refuses rather than writing blind when estimate() is missing", async () => {
    const s = fullStorage() as Record<string, unknown>;
    delete s.estimate;
    install(s as never);
    const { cacheAudioBlob } = await load();
    await expect(cacheAudioBlob("x", bytes(10))).resolves.toBe("no-estimate");
    expect(fs.files.size).toBe(0);
  });

  it("refuses when estimate() throws or reports no quota", async () => {
    const s = fullStorage();
    install({ ...s, estimate: async () => { throw new Error("nope"); } } as never);
    let mod = await load();
    await expect(mod.cacheAudioBlob("x", bytes(10))).resolves.toBe("no-estimate");

    install({ ...s, estimate: async () => ({ usage: 0 }) } as never);
    mod = await load();
    await expect(mod.cacheAudioBlob("y", bytes(10))).resolves.toBe("no-estimate");
    expect(fs.files.size).toBe(0);
  });

  it("without OPFS at all, resolves 'unsupported' and throws nothing", async () => {
    install({} as never);
    const { cacheAudioBlob } = await load();
    await expect(cacheAudioBlob("x", bytes(10))).resolves.toBe("unsupported");
  });
});
