"use client";

import { Starfield } from "@/components/desktop/Starfield";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="relative min-h-screen bg-midnight flex items-center justify-center p-8">
      <Starfield />
      <div className="relative z-10 w98-raised-dark bg-raised-surface glass-heavy max-w-[400px] w-full animate-fade-in">
        <div className="w98-titlebar-gradient px-2 py-[2px] flex items-center">
          <span className="w98-font text-hd-11 font-bold text-white truncate flex-1">
            High Desert - Error
          </span>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="text-hd-12 text-desktop-gray font-bold">
            We&apos;re experiencing technical difficulties
          </div>
          <div className="w98-inset-dark bg-inset-well p-3">
            <div className="text-hd-10 text-red-400 leading-relaxed font-mono break-all">
              {error.message || "An unexpected error occurred."}
            </div>
            {error.digest && (
              <div className="text-hd-9 text-bevel-dark mt-2">
                Error ID: {error.digest}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => window.location.reload()}
              className="w98-raised-dark bg-raised-surface text-desktop-gray px-4 py-1 text-hd-11 min-w-[75px] cursor-pointer"
            >
              Reload
            </button>
            <button
              onClick={reset}
              className="w98-raised-dark bg-raised-surface text-desktop-gray px-4 py-1 text-hd-11 min-w-[75px] cursor-pointer"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
