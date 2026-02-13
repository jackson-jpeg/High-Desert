"use client";

import { Window, Button } from "@/components/win98";

export default function DesktopError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center p-8 h-full">
      <div className="max-w-[400px] w-full">
        <Window title="Error" variant="dark">
          <div className="p-4 flex flex-col gap-3">
            <div className="text-[12px] text-desktop-gray font-bold">
              This page encountered an error
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
              <Button onClick={() => window.location.href = "/library"}>
                Go to Library
              </Button>
              <Button variant="dark" onClick={reset}>
                Try Again
              </Button>
            </div>
          </div>
        </Window>
      </div>
    </div>
  );
}
