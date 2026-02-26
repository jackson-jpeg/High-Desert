"use client";

import { Component, type ReactNode } from "react";
import { Window } from "@/components/win98";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches errors that occur during smart playlist generation.
 * Handles data processing errors, filtering issues, and other playlist-related failures.
 */
export class SmartPlaylistErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[SmartPlaylistErrorBoundary] Playlist generation error:", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Window title="Smart Playlists" variant="dark">
        <div className="p-4 flex flex-col gap-3">
          <div className="text-[13px] text-desktop-gray font-bold">
            Playlist Generation Error
          </div>
          <div className="text-[11px] text-bevel-dark leading-relaxed">
            Could not generate smart playlists. This might be due to corrupted episode data or a browser storage issue.
          </div>
          <div className="w98-inset-dark bg-inset-well p-2">
            <div className="text-[9px] text-red-400/70 font-mono break-all">
              {this.state.error?.message ?? "Unknown error"}
            </div>
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="w98-raised-dark bg-raised-surface text-desktop-gray px-4 py-1.5 text-[11px] min-w-[75px] cursor-pointer self-end"
          >
            Retry
          </button>
        </div>
      </Window>
    );
  }
}