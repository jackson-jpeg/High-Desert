"use client";

import { Dialog, Button } from "@/components/win98";

const SHORTCUTS = [
  { keys: "Space", action: "Play / Pause" },
  { keys: "\u2190", action: "Seek back 15s" },
  { keys: "\u2192", action: "Seek forward 30s" },
  { keys: "\u2191", action: "Volume up" },
  { keys: "\u2193", action: "Volume down" },
  { keys: "N", action: "Next track" },
  { keys: "P", action: "Previous track" },
  { keys: "M", action: "Mute / Unmute" },
  { keys: "/ or Ctrl+F", action: "Focus search" },
  { keys: "\u21E7\u2191 / \u21E7\u2193", action: "Navigate library" },
  { keys: "Enter", action: "Play selected" },
  { keys: "Delete", action: "Delete selected" },
  { keys: "Escape", action: "Clear selection" },
  { keys: "?", action: "Show this dialog" },
];

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
}

export function ShortcutsDialog({ open, onClose, isAdmin }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard Shortcuts" width="320px">
      <div className="p-4">
        <div className="flex flex-col gap-1">
          {SHORTCUTS.filter(({ keys }) => isAdmin || keys !== "Delete").map(({ keys, action }) => (
            <div key={keys} className="flex items-center justify-between gap-3 py-0.5">
              <span className="text-[10px] text-desktop-gray/80">{action}</span>
              <span className="text-[9px] text-desert-amber/60 tabular-nums flex-shrink-0">{keys}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end mt-4">
          <Button onClick={onClose}>OK</Button>
        </div>
      </div>
    </Dialog>
  );
}
