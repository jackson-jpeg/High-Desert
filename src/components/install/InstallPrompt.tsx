"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { dismissInstall, promptInstall, useInstallMode } from "@/services/install/install-prompt";

/**
 * "Put High Desert on your home screen": one slim line in the page's flow
 * (the Library under Continue listening, the phone's Live screen under the
 * phone lines), never fixed over anything, so it cannot cover the Listen
 * button, the call box or the first shows of the list (2026-10-12: it was a
 * three-line card above the Library's list on a phone). When and to whom:
 * src/services/install/install-prompt.ts.
 *
 * Its two buttons draw small and answer a 44 px touch (`hd-hit`'s ::after).
 */
export function InstallPrompt({ className }: { className?: string }) {
  const mode = useInstallMode();
  const [gone, setGone] = useState(false);
  if (!mode || gone) return null;

  const notNow = () => {
    dismissInstall();
    setGone(true);
  };

  return (
    <aside
      aria-label="Add High Desert to your home screen"
      data-testid="install-prompt"
      data-mode={mode}
      className={cn("w98-raised-dark bg-raised-surface flex items-center gap-2 pl-3 pr-1 min-h-[32px]", className)}
    >
      {mode === "ios" ? (
        <p className="flex-1 min-w-0 truncate text-hd-caption text-desktop-gray" data-testid="install-ios-steps">
          Install: tap Share <ShareIcon />, then Add to Home Screen.
        </p>
      ) : (
        <p className="flex-1 min-w-0 truncate text-hd-caption text-desktop-gray">
          Keep High Desert on your home screen.
        </p>
      )}
      {mode === "install" && (
        <button
          type="button"
          onClick={async () => {
            await promptInstall();
            setGone(true);
          }}
          data-testid="install-button"
          className="hd-hit relative w98-raised-dark bg-raised-surface px-3 py-0.5 w98-font text-hd-caption text-desert-amber cursor-pointer flex-shrink-0"
        >
          Install
        </button>
      )}
      <button
        type="button"
        onClick={notNow}
        data-testid="install-dismiss"
        aria-label="Not now"
        title="Not now"
        className="hd-hit relative w-7 h-7 flex items-center justify-center text-hd-body text-bevel-dark hover:text-desktop-gray cursor-pointer flex-shrink-0"
      >
        {"\u00d7"}
      </button>
    </aside>
  );
}

/** Safari's Share icon: a box with an arrow out of the top. Named in the text beside it. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      className="inline-block align-[-2px] text-signal-blue"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-testid="install-share-icon"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 11H5v10h14V11h-1" />
    </svg>
  );
}
