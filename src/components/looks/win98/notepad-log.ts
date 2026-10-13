import { tuneinText, type ArchiveLine, type LiveMessage, type TuneinNotice } from "@/services/live/client";
import { callerLabel } from "@/lib/live/chat-rows";

/**
 * The Notepad's wording for each kind of line (NotepadPhoneLines). A call is
 * a block of two lines:
 *
 *   Skeptic, calling from Reno · Line 3 · [10:42 PM]
 *   message
 *
 * A tune-in is one quiet line, and an archive moment is its own framed block
 * headed ">>> From the archive". Plain text, so the log reads the same copied
 * out of the window.
 */

/** "[10:42 PM]": Notepad's own time stamp (F5), in the reader's time zone. */
export function logTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "[--:--]";
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `[${h}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}]`;
}

export { callerLabel };

/** A call's first line: who, from where, on which line, when. */
export function callHead(m: LiveMessage): string {
  return `${callerLabel(m)} · ${m.line} · ${logTime(m.at)}`;
}

/** A whole call as text: the head, then the message on its own line. */
export function callLine(m: LiveMessage): string {
  return `${callHead(m)}\n${m.body}`;
}

/** A tune-in (or a run of them, folded): one line between asterisks. */
export function tuneinLine(n: TuneinNotice): string {
  return `${logTime(n.at)} *** ${tuneinText(n)} ***`;
}

/** An archive moment's heading: the archive's, never a caller's. */
export function archiveLabel(a: ArchiveLine): string {
  return a.reason === "on-air" ? ">>> From the archive, this show" : ">>> From the archive";
}

/** An archive moment's words: a quote in quotation marks with its speaker, a description as it is. */
export function archiveText(a: ArchiveLine): string {
  if (a.form !== "quote") return a.text;
  return a.speaker ? `“${a.text}” (${a.speaker})` : `“${a.text}”`;
}

/** A whole archive moment as text. */
export function archiveLine(a: ArchiveLine): string {
  return `${archiveLabel(a)} ${logTime(a.at)}\n${archiveText(a)}`;
}
