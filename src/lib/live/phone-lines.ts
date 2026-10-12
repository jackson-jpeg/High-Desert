/**
 * "Open the Phone Lines": one URL, in both looks (docs/live-qa.md).
 *
 * The phone's tab bar (Night) and taskbar (Win98) have a Phone Lines button
 * where Radio used to be; Win98's Start menu and Run box have one too, and
 * the installed app's shortcut. Each goes to `/live?lines=1`. The Live screen
 * reads the parameter (LiveStation's LinesIntentReader), opens the lines (the
 * sheet on a phone; the cursor in the call box on a desktop) and takes the
 * parameter out of the address bar, like a library intent. A URL rather than
 * an in-memory request, so it survives a reload, a home-screen shortcut and a
 * link, and pressing it again while already on /live works the same way.
 */

export const LINES_PARAM = "lines";

/** Where every "Phone Lines" button goes. */
export const PHONE_LINES_HREF = `/live?${LINES_PARAM}=1`;

interface ParamReader {
  get(name: string): string | null;
}

/** Whether the URL asks for the phone lines. Only `1`: anything else is ignored. */
export function wantsPhoneLines(params: ParamReader | null | undefined): boolean {
  return params?.get(LINES_PARAM) === "1";
}
