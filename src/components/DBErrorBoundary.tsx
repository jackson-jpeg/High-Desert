"use client";

import { Component, type ReactNode } from "react";
import { Starfield } from "@/components/desktop/Starfield";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches IndexedDB / Dexie errors that bubble up during rendering.
 * Common in private browsing modes where IDB is disabled or quota is 0.
 */
export class DBErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const isIDB =
      this.state.error?.name === "DatabaseClosedError" ||
      this.state.error?.name === "QuotaExceededError" ||
      this.state.error?.message?.includes("IndexedDB") ||
      this.state.error?.message?.includes("IDBDatabase");

    return (
      <div className="relative min-h-screen bg-midnight flex items-center justify-center p-8">
        <Starfield />
        <div className="relative z-10 w98-raised-dark bg-raised-surface glass-heavy max-w-[420px] w-full animate-fade-in">
          <div className="w98-titlebar-gradient px-2 py-[2px] flex items-center">
            <span className="w98-font text-hd-11 font-bold text-white truncate flex-1">
              High Desert — Storage Error
            </span>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <div className="text-hd-13 text-desktop-gray font-bold">
              {isIDB ? "Storage Unavailable" : "Something went wrong"}
            </div>
            <div className="text-hd-11 text-bevel-dark leading-relaxed">
              {isIDB ? (
                <>
                  High Desert needs browser storage (IndexedDB) to work.
                  This is usually blocked in <strong>private/incognito browsing</strong> modes
                  or when storage is full.
                </>
              ) : (
                "An unexpected error occurred while loading the application."
              )}
            </div>
            {isIDB && (
              <div className="text-hd-10 text-desert-amber/80 leading-relaxed">
                Try opening High Desert in a regular (non-private) browser window.
              </div>
            )}
            <div className="w98-inset-dark bg-inset-well p-2">
              <div className="text-hd-9 text-red-400/70 font-mono break-all">
                {this.state.error?.message ?? "Unknown error"}
              </div>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w98-raised-dark bg-raised-surface text-desktop-gray px-4 py-1.5 text-hd-11 min-w-[75px] cursor-pointer self-end"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
