#!/usr/bin/env node
/**
 * One origin for a local Live stack, the way nginx makes one in production:
 * /live-api/* goes to the phone-lines service (streamed, never buffered, so SSE
 * works), everything else to `next start`. For e2e/live-chat.spec.ts only.
 *
 *   node scripts/live-e2e-stack.mjs --port 3014 --app 3013 --live 3015
 *
 * X-Forwarded-For is passed through as the browser context set it: the e2e
 * contexts give themselves distinct addresses (anotherClientAddress), and the
 * service trusts the header only from loopback, which this proxy is.
 */
import http from "node:http";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const PORT = arg("port", 3014);
const APP = arg("app", 3013);
const LIVE = arg("live", 3015);

const server = http.createServer((req, res) => {
  const target = req.url.startsWith("/live-api/") ? LIVE : APP;
  const headers = { ...req.headers, "x-forwarded-for": req.headers["x-forwarded-for"] ?? "127.0.0.1" };
  const up = http.request({ host: "127.0.0.1", port: target, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("upstream unavailable");
  });
  req.pipe(up);
  // Tear the upstream down when the *browser* goes away (an SSE tab closing).
  // Not on req "close": Node emits that as soon as a GET's empty body has been
  // read, which destroyed every upstream before it answered.
  res.on("close", () => {
    if (!res.writableFinished) up.destroy();
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`[live-e2e-stack] http://127.0.0.1:${PORT} → app :${APP}, /live-api → :${LIVE}`));
