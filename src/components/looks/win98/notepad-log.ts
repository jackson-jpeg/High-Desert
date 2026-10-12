/**
 * The phone lines as a Notepad log (NotepadPhoneLines.tsx): one plain line
 * per call, tune-in and archive moment. Pure, so the wording is tested.
 *
 *   [10:42 PM] Line 3, Skeptic from Reno: message
 *   [10:44 PM] *** A listener just tuned in from Ohio ***
 *   [10:50 PM] >>> From the archive: Art signs on from Pahrump.
 */
import { tuneinText, type ArchiveLine, type LiveMessage, type TuneinNotice } from "@/services/live/client";

/** "[10:42 PM]", in the viewer's own time, as the chat shows times. */
export function logTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "[--:--]";
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `[${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}]`;
}

/** "Skeptic from Reno", or just "Skeptic". */
export function callerLabel(m: Pick<LiveMessage, "name" | "place">): string {
  return m.place ? `${m.name} from ${m.place}` : m.name;
}

/** The call, as one log line: time, line, caller, then what they said. */
export function callLine(m: LiveMessage): string {
  return `${logTime(m.at)} ${m.line}, ${callerLabel(m)}: ${m.body}`;
}

export function tuneinLine(n: TuneinNotice): string {
  return `${logTime(n.at)} *** ${tuneinText(n)} ***`;
}

/** An archive moment: marked as the archive's, never as a caller's; quotes in quotation marks. */
export function archiveLine(a: ArchiveLine): string {
  const label = a.reason === "on-air" ? "From the archive, this show" : "From the archive";
  const text = a.form === "quote" ? `“${a.text}”${a.speaker ? ` (${a.speaker})` : ""}` : a.text;
  return `${logTime(a.at)} >>> ${label}: ${text}`;
}
