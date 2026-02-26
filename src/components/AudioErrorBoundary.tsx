"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AudioErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[AudioErrorBoundary] Web Audio API failure:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w98-inset-dark bg-inset-well p-3 text-center max-w-xs">
            <div className="text-[9px] text-bevel-dark mb-2">
              Audio player unavailable — Web Audio API not supported
            </div>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="text-[9px] text-title-bar-blue hover:text-title-bar-blue/80 cursor-pointer px-2 py-0.5 w98-raised-dark bg-raised-surface transition-colors-fast"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}