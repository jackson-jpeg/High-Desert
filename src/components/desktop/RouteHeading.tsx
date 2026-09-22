/**
 * The page's one `<h1>`, for a route whose Win98 chrome has no title of its
 * own to promote.
 *
 * The shell draws a menu bar, nav tabs and window title bars, and none of
 * them names the page — so /library, /radio and /stats had no h1 at all, and a
 * screen reader's "jump to main heading" found nothing. Visually hidden rather
 * than drawn: adding a visible banner would restyle a design that already
 * shows the active tab. Where a page does have a visible title that reads as
 * its name (/search's window, /scanner's section header), that element is the
 * h1 instead, and this is not used.
 *
 * Rendered from the route's layout.tsx, not its page, so it is present in
 * every state the page can be in — loading, empty, redirecting — and a page's
 * own headings start at h2. `src/app/__tests__/route-headings.test.tsx` holds
 * every route to exactly one.
 */
export function RouteHeading({ children }: { children: string }) {
  return <h1 className="sr-only">{children}</h1>;
}
