"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-midnight flex items-center justify-center p-8">
      <div className="w98-raised-dark bg-raised-surface max-w-[400px] w-full">
        <div className="w98-titlebar-gradient px-2 py-[2px] flex items-center">
          <span className="w98-font text-[11px] font-bold text-white truncate flex-1">
            High Desert - Error
          </span>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="text-[12px] text-desktop-gray font-bold">
            Something went wrong
          </div>
          <div className="w98-inset-dark bg-inset-well p-3">
            <div className="text-[10px] text-red-400 leading-relaxed font-mono break-all">
              {error.message || "An unexpected error occurred."}
            </div>
            {error.digest && (
              <div className="text-[9px] text-bevel-dark mt-2">
                Error ID: {error.digest}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => window.location.reload()}
              className="w98-raised-dark bg-raised-surface text-desktop-gray px-4 py-1 text-[11px] min-w-[75px] cursor-pointer"
            >
              Reload
            </button>
            <button
              onClick={reset}
              className="w98-raised-dark bg-raised-surface text-desktop-gray px-4 py-1 text-[11px] min-w-[75px] cursor-pointer"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
