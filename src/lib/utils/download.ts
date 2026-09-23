/**
 * Hand the browser a JSON file to save.
 *
 * A Blob and an `<a download>` — no server round trip, no data URL. Checked
 * against the app's policy (src/lib/csp.ts): a `blob:` URL is same-origin, and
 * following an anchor to it is a navigation-download, which no fetch directive
 * governs, so nothing needs relaxing. The service worker never sees it either:
 * workers only intercept http(s) fetches, never `blob:`.
 *
 * The anchor is attached before `click()` (Firefox ignores a click on a
 * detached anchor) and the URL is revoked on a delay rather than immediately —
 * revoking in the same task has cancelled the download in Safari.
 *
 * Returns the file's size in bytes.
 */
export function downloadJson(filename: string, data: unknown, opts: { compact?: boolean } = {}): number {
  const json = opts.compact ? JSON.stringify(data) : JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return blob.size;
}
