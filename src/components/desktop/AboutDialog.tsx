"use client";

import { Dialog, Button } from "@/components/win98";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
}

export function AboutDialog({ open, onClose, isAdmin }: AboutDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="About High Desert" width="400px">
      <div className="flex flex-col items-center gap-0 p-6 text-center bg-midnight/90">
        <div className="text-[18px] font-bold text-desert-amber crt-amber tracking-wider mb-1">
          HIGH DESERT
        </div>
        <div className="text-[11px] text-desktop-gray/80 mb-4">
          Art Bell Radio Archive
        </div>
        <div className="w-40 h-[1px] bg-gradient-to-r from-transparent via-desert-amber/30 to-transparent mb-4" />
        <div
          className="text-[10px] text-static-green/60 italic mb-5"
          style={{ textShadow: "0 0 4px rgba(74, 222, 128, 0.2)" }}
        >
          &ldquo;From the Kingdom of Nye...&rdquo;
        </div>
        <div className="flex flex-col items-center gap-0.5 mb-5">
          <div className="text-[10px] text-desert-amber/60">Art Bell</div>
          <div className="text-[9px] text-bevel-dark/60">1945 &ndash; 2018</div>
        </div>
        <div className="text-[8px] text-bevel-dark/40 mb-5">
          v0.4.0{isAdmin ? " (Admin)" : ""}
        </div>
        <Button onClick={onClose}>OK</Button>
      </div>
    </Dialog>
  );
}
