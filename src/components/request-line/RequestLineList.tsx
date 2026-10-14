"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { showPath } from "@/lib/shows/describe";
import { REQUEST_LINE_PATH, REQUEST_SHARE_TITLE } from "@/lib/live/request-line";
import type { PageNomination } from "@/lib/live/request-line-page";
import { fetchRequestLine, vetoNomination, voteFor, type Nomination } from "@/services/live/request-client";

type Row = PageNomination & { mine?: boolean; voted?: boolean };

const button =
  "w98-raised-dark bg-raised-surface w98-font text-hd-body text-desktop-gray hover:text-desert-amber px-3 min-h-touch inline-flex items-center justify-center disabled:opacity-100 disabled:text-bevel-dark";
const link = "text-signal-blue hover:text-desktop-gray transition-colors-fast";

/**
 * The day's nominations with their votes. Rendered on the server from the
 * database (so the list is in the HTML); in the browser it asks the Request
 * Line which picks are this browser's own and which it has voted for, and
 * offers one-tap Vote, an admin's Veto and Share my pick. Counts re-read
 * after every tap, never guessed.
 */
export function RequestLineList({ initial, day, closesAt }: { initial: readonly PageNomination[]; day: string; closesAt: number }) {
  const [rows, setRows] = useState<Row[]>(() => [...initial]);
  const [admin, setAdmin] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  const merge = (fresh: Nomination[]) =>
    setRows((prev) => {
      const slugs = new Map(prev.map((r) => [r.fileHash, r.slug]));
      return fresh.map((n) => ({ ...n, slug: slugs.get(n.fileHash) ?? null }));
    });

  useEffect(() => {
    let live = true;
    void fetchRequestLine().then((s) => {
      if (!live || !s) return;
      if (s.day === day) merge(s.nominations);
      setAdmin(s.admin);
    });
    const t = setTimeout(() => setClosed(true), Math.max(0, closesAt - Date.now()));
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [day, closesAt]);

  const refresh = async () => {
    const s = await fetchRequestLine();
    if (s && s.day === day) merge(s.nominations);
  };

  const onVote = async (id: number) => {
    const r = await voteFor(id);
    setNote(r.ok ? (r.counted ? "Vote counted." : "You already voted for that one.") : r.message);
    await refresh();
  };

  const onVeto = async (id: number) => {
    setNote((await vetoNomination(id)) ? "Taken off the Request Line." : "Could not veto that one.");
    await refresh();
  };

  const onShare = async (r: Row) => {
    const url = `${window.location.origin}${REQUEST_LINE_PATH}`;
    const text = `${REQUEST_SHARE_TITLE}: ${r.title}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: REQUEST_SHARE_TITLE, text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setNote("Link copied. Send it to someone who should vote.");
    } catch {
      // The share sheet was dismissed; nothing to say.
    }
  };

  if (!rows.length) {
    return (
      <p data-testid="request-empty" className="text-hd-body text-desktop-gray p-2">
        Nobody has picked a show yet. Be the first: press Request it on any show.
      </p>
    );
  }

  return (
    <>
      {note ? (
        <p role="status" data-testid="request-note" className="text-hd-caption text-desktop-gray mb-2">
          {note}
        </p>
      ) : null}
      <ol className="hd-show-list hd-request-nominations flex flex-col gap-1" data-testid="request-list">
        {rows.map((r, i) => (
          <li key={r.id} data-testid="request-row" data-nomination={r.id} className={cn("hd-show-list-item hd-request-row py-2 flex items-center gap-3", r.mine && "hd-request-mine")}>
            <span className="w-6 shrink-0 text-right text-hd-caption tabular-nums text-bevel-dark">{i + 1}</span>
            <span className="flex-1 min-w-0 flex flex-col">
              {r.slug ? (
                <Link href={showPath(r.slug)} className={cn("text-hd-body", link)}>
                  {r.title}
                </Link>
              ) : (
                <span className="text-hd-body text-desktop-gray">{r.title}</span>
              )}
              <span className="text-hd-caption text-bevel-dark">
                {[r.guestName ? `with ${r.guestName}` : null, r.airDate].filter(Boolean).join(" · ")}
              </span>
              <span className="text-hd-caption text-desktop-gray">
                Picked by {r.name}
                {r.place ? `, calling from ${r.place}` : ""}
                {r.mine ? " (you)" : ""}
              </span>
              {r.note ? <span className="text-hd-caption text-desktop-gray italic">&ldquo;{r.note}&rdquo;</span> : null}
            </span>
            <span className="shrink-0 flex flex-col items-end gap-1">
              <span data-testid="request-votes" className="w98-font text-hd-title text-desert-amber tabular-nums">
                {r.votes} <span className="text-hd-micro text-bevel-dark uppercase">{r.votes === 1 ? "vote" : "votes"}</span>
              </span>
              <span className="flex gap-2">
                <button type="button" className={button} disabled={closed || r.voted} onClick={() => onVote(r.id)} data-testid="request-vote">
                  {r.voted ? "Voted" : "Vote"}
                </button>
                {r.mine ? (
                  <button type="button" className={button} onClick={() => onShare(r)} data-testid="request-share">
                    Share my pick
                  </button>
                ) : null}
                {admin ? (
                  <button type="button" className={cn(button, "text-red-400")} onClick={() => onVeto(r.id)} data-testid="request-veto">
                    Veto
                  </button>
                ) : null}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
