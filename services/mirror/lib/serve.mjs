import http from "node:http";

/**
 * Start answering, then start seeding — in that order, and without waiting.
 *
 * Seeding the pins means adding every pinned torrent to the client, 338 of
 * them after the first nightly warm. The first deploy after that warm awaited
 * it before listen(): health never answered inside deploy-mirror.sh's 30s,
 * the deploy rolled back, and the previous copy — which did the same — left
 * the mirror down. Requests never needed the pins seeded: a complete file is
 * served from disk.
 */
export function startServer({ gateway, port, host = "127.0.0.1", log = () => {} }) {
  const server = http.createServer((req, res) => {
    gateway.handle(req, res).catch((err) => {
      log(`request: ${err?.stack ?? err}`);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    });
  });
  const listening = new Promise((resolve) => server.listen(port, host, resolve));
  const seeding = listening.then(() => gateway.seedPins()).catch((err) => log(`seeding: ${err?.message ?? err}`));
  return { server, listening, seeding };
}
