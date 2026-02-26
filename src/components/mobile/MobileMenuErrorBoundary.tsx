"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class MobileMenuErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[MobileMenuErrorBoundary] Mobile menu rendering failure:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed bottom-0 inset-x-0 z-[101] glass-heavy rounded-t-2xl overflow-hidden pb-[var(--safe-bottom)] animate-glass-sheet">
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="w-8 h-[3px] rounded-full bg-white/15" />
          </div>
          <div className="flex flex-col p-4">
            <div className="text-[14px] text-desktop-gray text-center mb-3">
              Menu unavailable
            </div>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="w-full text-center px-4 py-3 text-[14px] min-h-[48px] text-bevel-dark cursor-pointer active:bg-white/[0.04]"
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