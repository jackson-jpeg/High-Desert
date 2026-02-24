"use client";

import { Dialog, Button } from "@/components/win98";

interface ShortcutEntry {
  keys: string;
  action: string;
}

const SECTIONS: { title: string; shortcuts: ShortcutEntry[] }[] = [
  {
    title: "Playback",
    shortcuts: [
      { keys: "Space", action: "Play / Pause" },
      { keys: "←", action: "Seek back 15s" },
      { keys: "→", action: "Seek forward 30s" },
      { keys: "↑", action: "Volume up" },
      { keys: "↓", action: "Volume down" },
      { keys: "M", action: "Mute / Unmute" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { keys: "N", action: "Next track" },
      { keys: "P", action: "Previous track" },
      { keys: "⇧↑ / ⇧↓", action: "Navigate library" },
      { keys: "Enter", action: "Play selected" },
      { keys: "Escape", action: "Clear selection" },
    ],
  },
  {
    title: "Library",
    shortcuts: [
      { keys: "/ or ⌘F", action: "Focus search" },
      { keys: "Delete", action: "Delete selected" },
    ],
  },
  {
    title: "Radio",
    shortcuts: [
      { keys: "?", action: "Show this dialog" },
    ],
  },
];

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
}

export function ShortcutsDialog({ open, onClose, isAdmin }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard Shortcuts" width="360px">
      <div className="p-3 max-h-[calc(80vh-120px)] md:max-h-[400px] overflow-y-auto">
        <div className="flex flex-col gap-3">
          {SECTIONS.map((section) => {
            const shortcuts = section.shortcuts.filter(
              (s) => isAdmin || s.keys !== "Delete"
            );
            if (shortcuts.length === 0) return null;
            return (
              <fieldset
                key={section.title}
                className="border border-bevel-dark/30 rounded-sm px-2.5 pb-2 pt-0"
              >
                <legend className="text-[9px] text-desert-amber/70 px-1 uppercase tracking-wider">
                  {section.title}
                </legend>
                <div className="flex flex-col gap-0.5">
                  {shortcuts.map(({ keys, action }) => (
                    <div
                      key={keys}
                      className="flex items-center justify-between gap-3 py-0.5"
                    >
                      <span className="text-[10px] text-desktop-gray/80">
                        {action}
                      </span>
                      <kbd className="text-[9px] text-desert-amber bg-raised-surface w98-raised-dark px-1.5 py-0.5 tabular-nums flex-shrink-0 leading-tight">
                        {keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
        <div className="flex justify-end mt-3">
          <Button onClick={onClose}>OK</Button>
        </div>
      </div>
    </Dialog>
  );
}
