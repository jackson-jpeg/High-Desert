"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error(`[WidgetErrorBoundary${this.props.name ? `: ${this.props.name}` : ""}]`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w98-inset-dark bg-inset-well p-3 text-center">
          <div className="text-[9px] text-bevel-dark mb-2">
            Something went wrong{this.props.name ? ` in ${this.props.name}` : ""}.
          </div>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="text-[9px] text-title-bar-blue hover:text-title-bar-blue/80 cursor-pointer px-2 py-0.5 w98-raised-dark bg-raised-surface transition-colors-fast"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
