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
 * Catches file system access errors that occur during folder selection.
 * Handles permission denied, file not found, and other file system related errors.
 */
export class ScannerErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[ScannerErrorBoundary] File system error:", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const isPermissionError = 
      this.state.error?.name === "NotAllowedError" ||
      this.state.error?.message?.includes("permission") ||
      this.state.error?.message?.includes("denied");

    const isFileSystemError = 
      this.state.error?.name === "NotFoundError" ||
      this.state.error?.name === "AbortError" ||
      this.state.error?.message?.includes("file system") ||
      this.state.error?.message?.includes("directory");

    return (
      <Window title="Folder Access Error" variant="dark">
        <div className="p-4 flex flex-col gap-3">
          <div className="text-[13px] text-desktop-gray font-bold">
            {isPermissionError ? "Permission Denied" : "Folder Access Error"}
          </div>
          <div className="text-[11px] text-bevel-dark leading-relaxed">
            {isPermissionError ? (
              "High Desert needs permission to access your folders. Please check your browser settings and try again."
            ) : isFileSystemError ? (
              "Could not access the selected folder. Please ensure it exists and try again."
            ) : (
              "An unexpected error occurred while accessing the folder."
            )}
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