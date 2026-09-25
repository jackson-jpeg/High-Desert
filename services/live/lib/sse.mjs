/**
 * The downstream half: one Server-Sent Events hub for every open stream.
 *
 * An event is serialised once and the same string written to every client, so
 * a broadcast to 200 listeners is 200 socket writes and one JSON.stringify. A
 * client whose socket is not draining (more than MAX_BUFFERED_BYTES queued) is
 * dropped rather than buffered for: its EventSource reconnects and catches up
 * from Last-Event-ID, which is cheaper than holding its backlog in memory.
 *
 * Heartbeat: a comment line every HEARTBEAT_MS keeps nginx's read timeout and
 * any idle-closing middlebox from ending a quiet stream.
 */

import { HEARTBEAT_MS, MAX_BUFFERED_BYTES } from "./config.mjs";

export function frame(event, data, id) {
  return `${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createHub({ heartbeatMs = HEARTBEAT_MS } = {}) {
  const clients = new Set();
  const byRef = new Map();
  let sent = 0;

  function remove(client) {
    if (!clients.delete(client)) return;
    const set = byRef.get(client.ref);
    if (set) {
      set.delete(client);
      if (set.size === 0) byRef.delete(client.ref);
    }
    client.onClose?.();
  }

  function write(client, chunk) {
    if (client.res.writableLength > MAX_BUFFERED_BYTES) {
      client.res.destroy();
      remove(client);
      return;
    }
    client.res.write(chunk);
    sent++;
  }

  const timer = setInterval(() => {
    for (const c of clients) write(c, `: ping\n\n`);
  }, heartbeatMs);
  timer.unref?.();

  return {
    add(res, ref, onClose) {
      const client = { res, ref, onClose };
      clients.add(client);
      if (!byRef.has(ref)) byRef.set(ref, new Set());
      byRef.get(ref).add(client);
      res.on("close", () => remove(client));
      return client;
    },
    send(client, event, data, id) {
      write(client, frame(event, data, id));
    },
    broadcast(event, data, id) {
      const chunk = frame(event, data, id);
      for (const c of clients) write(c, chunk);
    },
    /** Every stream a caller holds. */
    streamsOf(ref) {
      return byRef.get(ref)?.size ?? 0;
    },
    isConnected(ref) {
      return byRef.has(ref);
    },
    /** End every stream a caller holds (a ban). */
    closeRef(ref) {
      for (const c of [...(byRef.get(ref) ?? [])]) {
        c.res.end();
        remove(c);
      }
    },
    get size() {
      return clients.size;
    },
    get sent() {
      return sent;
    },
    close() {
      clearInterval(timer);
      for (const c of [...clients]) {
        c.res.end();
        remove(c);
      }
    },
  };
}
