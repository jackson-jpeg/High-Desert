"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[GlobalErrorBoundary]", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="relative min-h-screen bg-midnight flex items-center justify-center p-8">
        <div className="relative z-10 w98-raised-dark bg-raised-surface glass-heavy max-w-[420px] w-full animate-fade-in">
          <div className="w98-titlebar-gradient px-2 py-[2px] flex items-center">
            <span className="w98-font text-[11px] font-bold text-white truncate flex-1">
              High Desert — Critical Error
            </span>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <div className="text-[13px] text-desktop-gray font-bold">
              Application Error
            </div>
            <div className="text-[11px] text-bevel-dark leading-relaxed">
              High Desert encountered an unexpected error. Please try reloading the page.
            </div>
            <div className="w98-inset-dark bg-inset-well p-2">
              <div className="text-[9px] text-red-400/70 font-mono break-all">
                {this.state.error?.message ?? "Unknown error"}
              </div>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w98-raised-dark bg-raised-surface text-desktop-gray px-4 py-1.5 text-[11px] min-w-[75px] cursor-pointer self-end"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}