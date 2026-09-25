// @vitest-environment node
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { createHub, frame } from "../lib/sse.mjs";
import { MAX_BUFFERED_BYTES } from "../lib/config.mjs";

/** A response-shaped object: records writes, reports a queue length the test sets. */
function fakeRes() {
  const res = new EventEmitter();
  res.writes = [];
  res.writableLength = 0;
  res.destroyed = false;
  res.write = (chunk) => res.writes.push(chunk);
  res.end = () => res.emit("close");
  res.destroy = () => {
    res.destroyed = true;
    res.emit("close");
  };
  return res;
}

describe("the SSE hub", () => {
  it("serialises a broadcast once and writes the same frame to every stream", () => {
    const hub = createHub({ heartbeatMs: 60_000 });
    const a = fakeRes();
    const b = fakeRes();
    hub.add(a, "r1");
    hub.add(b, "r2");
    hub.broadcast("message", { id: 7, body: "hi" }, 7);
    expect(a.writes).toEqual([frame("message", { id: 7, body: "hi" }, 7)]);
    expect(b.writes).toEqual(a.writes);
    expect(a.writes[0]).toBe('id: 7\nevent: message\ndata: {"id":7,"body":"hi"}\n\n');
    hub.close();
  });

  it("drops a stream that is not draining instead of buffering for it; the others still get the event", () => {
    const hub = createHub({ heartbeatMs: 60_000 });
    const slow = fakeRes();
    const ok = fakeRes();
    hub.add(slow, "slow");
    hub.add(ok, "ok");
    slow.writableLength = MAX_BUFFERED_BYTES + 1;
    hub.broadcast("message", { id: 1 }, 1);
    expect(slow.destroyed).toBe(true);
    expect(slow.writes).toEqual([]);
    expect(hub.size).toBe(1);
    expect(hub.isConnected("slow")).toBe(false);
    expect(ok.writes).toHaveLength(1);
    hub.close();
  });

  it("a stream exactly at the limit is kept", () => {
    const hub = createHub({ heartbeatMs: 60_000 });
    const res = fakeRes();
    hub.add(res, "r");
    res.writableLength = MAX_BUFFERED_BYTES;
    hub.broadcast("slow", { on: true });
    expect(res.destroyed).toBe(false);
    expect(res.writes).toHaveLength(1);
    hub.close();
  });

  it("closeRef ends every stream one caller holds, and only theirs", () => {
    const hub = createHub({ heartbeatMs: 60_000 });
    const [x1, x2, y] = [fakeRes(), fakeRes(), fakeRes()];
    hub.add(x1, "x");
    hub.add(x2, "x");
    hub.add(y, "y");
    expect(hub.streamsOf("x")).toBe(2);
    hub.closeRef("x");
    expect(hub.streamsOf("x")).toBe(0);
    expect(hub.size).toBe(1);
    expect(hub.isConnected("y")).toBe(true);
    hub.close();
  });
});
