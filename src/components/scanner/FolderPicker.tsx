"use client";

import { useRef, useCallback, useState } from "react";
import { Button, Window } from "@/components/win98";
import { cn } from "@/lib/utils/cn";

interface FolderPickerProps {
  onPickNative: () => void;
  onPickFallback: (fileList: FileList) => void;
  supportsNativePicker: boolean;
  disabled?: boolean;
}

export function FolderPicker({
  onPickNative,
  onPickFallback,
  supportsNativePicker,
  disabled = false,
}: FolderPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleBrowse = useCallback(() => {
    if (supportsNativePicker) {
      onPickNative();
    } else {
      inputRef.current?.click();
    }
  }, [supportsNativePicker, onPickNative]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        onPickFallback(e.target.files);
      }
    },
    [onPickFallback],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onPickFallback(e.dataTransfer.files);
      }
    },
    [onPickFallback],
  );

  return (
    <Window title="Select Folder" variant="dark">
      <div className="p-4 flex flex-col gap-4">
        <div className="text-hd-11 text-desktop-gray">
          Choose a folder containing Art Bell radio archives (MP3, WMA, WAV,
          FLAC, OGG, M4A, AAC).
        </div>

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "w98-inset-dark flex flex-col items-center justify-center gap-3 p-8",
            "min-h-[120px] transition-colors-fast",
            dragOver
              ? "bg-title-bar-blue/20 border-title-bar-blue"
              : "bg-inset-well",
            disabled && "opacity-50 pointer-events-none",
          )}
        >
          <div className="text-hd-24 text-bevel-dark">
            {disabled ? "\u23F3" : dragOver ? "+" : "\u{1F4C1}"}
          </div>
          <div className="text-hd-11 text-bevel-dark text-center">
            {disabled ? (
              "Scanning in progress..."
            ) : (
              <>
                Drag &amp; drop a folder here
                <br />
                or
              </>
            )}
          </div>
          {!disabled && (
            <Button variant="dark" onClick={handleBrowse}>
              Browse...
            </Button>
          )}
        </div>

        {/* Hidden fallback input */}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleInputChange}
          /* @ts-expect-error webkitdirectory is non-standard */
          webkitdirectory=""
          multiple
        />

        {!supportsNativePicker && (
          <div className="text-hd-10 text-bevel-dark">
            Your browser uses the legacy file picker. For best results, use
            Chrome or Edge.
          </div>
        )}
      </div>
    </Window>
  );
}
