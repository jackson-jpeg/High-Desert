/**
 * One `Range: bytes=…` header against a file of `length` bytes (RFC 9110 §14).
 *
 *   null                       → no usable Range: serve the whole file, 200
 *   { unsatisfiable: true }    → 416, `Content-Range: bytes *\/length`
 *   { start, end }             → 206, inclusive offsets
 *
 * A syntactically invalid header is ignored (the RFC says so; a 416 there
 * would break clients that send something odd but accept a 200). Of several
 * ranges only the first is served — no browser asks media for more than one.
 */
export function parseRange(header, length) {
  if (!header) return null;
  const m = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*(?:,.*)?$/i.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // Suffix: the last N bytes.
    const n = Number(m[2]);
    if (n === 0) return { unsatisfiable: true };
    return { start: Math.max(0, length - n), end: length - 1 };
  }
  const start = Number(m[1]);
  let end = m[2] === "" ? length - 1 : Number(m[2]);
  if (start >= length || end < start) return { unsatisfiable: true };
  if (end >= length) end = length - 1;
  return { start, end };
}
