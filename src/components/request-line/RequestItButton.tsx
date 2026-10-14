"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { requestShow, requestedText } from "@/services/live/request-client";
import { REQUEST_LINE_PATH } from "@/lib/live/request-line";

/**
 * "Request it": nominate this show for tonight's 10 PM slot on the station
 * (docs/request-line.md). On a show page and in the Library's episode panel
 * (both looks). One nomination per listener per day; a show already up gets
 * this listener's vote instead. The answer, good or not, is said beside the
 * button with a link to the Request Line, never a toast that disappears.
 */
export function RequestItButton({ fileHash, className, linkClassName }: { fileHash: string; className?: string; linkClassName?: string }) {
  const [state, setState] = useState<{ busy: boolean; text: string | null; ok: boolean }>({ busy: false, text: null, ok: false });

  const onClick = async () => {
    setState({ busy: true, text: null, ok: false });
    const r = await requestShow(fileHash);
    setState({ busy: false, ok: r.ok, text: r.ok ? requestedText(r) : r.message });
  };

  return (
    <span className="hd-request-it inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="request-it">
      <button
        type="button"
        onClick={onClick}
        disabled={state.busy}
        className={className}
        title="Ask the station to play this tonight at 10 PM Pacific"
        data-testid="request-it-button"
      >
        {state.busy ? "Requesting..." : "Request it"}
      </button>
      {state.text ? (
        <span role="status" data-testid="request-it-status" data-ok={state.ok ? "true" : "false"} className={cn("text-hd-caption", state.ok ? "text-desktop-gray" : "text-bevel-dark")}>
          {state.text}{" "}
          <a href={REQUEST_LINE_PATH} className={linkClassName ?? "underline text-signal-blue"}>
            See the Request Line
          </a>
        </span>
      ) : null}
    </span>
  );
}
