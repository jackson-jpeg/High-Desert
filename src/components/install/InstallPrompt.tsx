"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { dismissInstall, promptInstall, useInstallMode } from "@/services/install/install-prompt";

/**
 * "Put High Desert on your home screen": a small card in the page's flow
 * (the Library under Continue listening, the phone's Live screen under the
 * phone lines), never fixed over anything, so it cannot cover the Listen
 * button or the call box. When and to whom: src/services/install/install-prompt.ts.
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
      className={cn("w98-raised-dark bg-raised-surface flex flex-col gap-2 px-3 py-2", className)}
    >
      <p className="text-hd-body text-desktop-gray">
        Keep High Desert on your home screen, one tap from the station.
      </p>
      {mode === "ios" && (
        <p className="text-hd-caption text-bevel-dark flex flex-wrap items-center gap-x-1" data-testid="install-ios-steps">
          <span>Tap Share</span>
          <ShareIcon />{" "}
          <span>at the bottom of Safari, then Add to Home Screen.</span>
        </p>
      )}
      <div className="flex items-center gap-2">
        {mode === "install" && (
          <button
            type="button"
            onClick={async () => {
              await promptInstall();
              setGone(true);
            }}
            data-testid="install-button"
            className="w98-raised-dark bg-raised-surface min-h-touch px-4 w98-font text-hd-body text-desert-amber cursor-pointer"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={notNow}
          data-testid="install-dismiss"
          className="min-h-touch px-3 text-hd-caption text-bevel-dark underline cursor-pointer"
        >
          Not now
        </button>
      </div>
    </aside>
  );
}

/** Safari's Share icon: a box with an arrow out of the top. Named in the text beside it. */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      className="inline-block text-signal-blue"
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
